---
title: "Queue — vì sao không phải lúc nào cũng xử lý request ngay lập tức"
description: "Một số việc không cần làm ngay: gửi email, tạo report, resize ảnh. Queue tách việc nhận request và xử lý request — giúp hệ thống responsive và resilient hơn."
category: system-design
pubDate: 2024-03-06
series: "Phần 7: Backend & Hệ thống"
tags: ["queue", "async", "message-queue"]
---

Ở HMS, có một loại request tốn thời gian: export data.

User bấm "Export all appointments as PDF", hệ thống phải:
- Query database 10,000+ appointments
- Render PDF
- Send email

Cả process này tốn 30+ seconds. Nếu hệ thống chặn 30 seconds chỉ để export, user sẽ timeout.

Giải pháp: **queue**.

Thay vì xử lý ngay, hệ thống:
1. Nhận request → tạo export task → put vào queue → respond ngay (< 1 second)
2. Background worker nhận task từ queue → xử lý 30 seconds
3. Khi xong, send email tới user hoặc update status

User không phải chờ 30 seconds. Hệ thống không phải consume thread 30 seconds.

---

## Queue là gì — và tại sao nó useful

Queue là một data structure nơi **producers put messages, consumers consume**.

```
User request (Producer)
    ↓
[ Queue: [task1, task2, task3, ...] ]
    ↓
Background worker (Consumer) — pick task, process, delete from queue
```

Trong HMS context:

```java
// Synchronous — user chờ
@PostMapping("/exports/appointments")
public ExportResponse exportAppointments(ExportRequest req) {
    // Chặn 30 seconds
    byte[] pdf = generatePdf(req);  // 20s
    sendEmail(pdf);                 // 8s
    return new ExportResponse("exported");
}
// User chờ 30 seconds, thread tốn 30 seconds
```

```java
// Asynchronous — user không chờ
@PostMapping("/exports/appointments")
public ExportResponse exportAppointments(ExportRequest req) {
    // Tạo task, put vào queue
    ExportTask task = new ExportTask(req);
    exportQueue.enqueue(task);  // < 1ms
    
    // Return immediately
    return new ExportResponse("export queued, you will receive email");
}

// Background worker (separate thread/process)
@Component
public class ExportWorker {
    @Scheduled(fixedRate = 1000)  // Poll queue every 1s
    public void processQueue() {
        ExportTask task = exportQueue.dequeue();
        if (task != null) {
            byte[] pdf = generatePdf(task.getRequest());  // 20s
            sendEmail(pdf);                               // 8s
        }
    }
}
// User gets response < 1ms, thread released, task processed in background
```

---

## Khi nào dùng queue

**Use queue khi:**

1. **Task tốn thời gian** (> 1 second) và không cần response ngay
   - Export PDF ✓
   - Send notification ✓
   - Generate report ✓
   - Background index update ✓

2. **Task có thể fail và cần retry**
   - Send email (network fail, retry lần sau)
   - Call external API (timeout, circuit break, retry)
   - Update data (constraint violation, retry)

3. **Task low priority so với user-facing requests**
   - Cleanup logs
   - Sync cache
   - Analytics

**Don't use queue khi:**

1. **Task must complete before respond** (synchronous requirement)
   - Booking appointment (must confirm slot immediately)
   - Payment processing (must know result before returning)
   - Authentication (must validate before allowing access)

2. **Task cần respond data trực tiếp**
   - GET doctor list (need data now)
   - Search appointment (need results now)
   - Validate form input (need error message now)

3. **Task thường nhanh** (< 100ms)
   - Simple queries
   - Cache lookup
   - Data validation
   - Overhead queue thường > task time

---

## Queue implementation options

**Option 1: In-memory queue (simple, limited)**

```java
@Component
public class SimpleQueue {
    private final Queue<ExportTask> queue = new ConcurrentLinkedQueue<>();
    
    public void enqueue(ExportTask task) {
        queue.offer(task);
    }
    
    public ExportTask dequeue() {
        return queue.poll();
    }
}
```

Lợi: Simple, zero dependencies
Vấn đề:
- Data lost nếu server crash
- Single server only (multiple server instances không share queue)
- No persistence, no retry

**Option 2: Message broker (RabbitMQ, Kafka)**

```java
@Configuration
public class RabbitMQConfig {
    @Bean
    public Queue exportTaskQueue() {
        return new Queue("export-tasks", true);  // Durable
    }
}

@Component
public class ExportProducer {
    private final RabbitTemplate rabbitTemplate;
    
    public void enqueue(ExportTask task) {
        rabbitTemplate.convertAndSend("export-tasks", task);
    }
}

@Component
public class ExportConsumer {
    @RabbitListener(queues = "export-tasks")
    public void processTask(ExportTask task) {
        byte[] pdf = generatePdf(task);
        sendEmail(pdf);
    }
}
```

Lợi:
- Persistent (survive server crash)
- Multiple producers/consumers
- Automatic retry + dead-letter queue
- Scalable

Vấn đề:
- Overhead, complexity
- Another service to operate
- Overkill cho single-server hobby project

**Option 3: Database as queue (pragmatic)**

```java
@Entity
@Table(name = "export_tasks")
public class ExportTask {
    @Id
    @GeneratedValue
    private Long id;
    
    private String status;  // PENDING, PROCESSING, DONE, FAILED
    private LocalDateTime createdAt;
    private LocalDateTime processedAt;
    // ... request data
}

@Component
public class ExportProducer {
    public void enqueue(ExportTaskRequest req) {
        ExportTask task = new ExportTask();
        task.setStatus("PENDING");
        task.setCreatedAt(now);
        exportTaskRepository.save(task);
    }
}

@Component
public class ExportWorker {
    @Scheduled(fixedRate = 1000)
    public void processPendingTasks() {
        List<ExportTask> pending = exportTaskRepository
            .findByStatusOrderByCreatedAt("PENDING")
            .stream()
            .limit(10)  // Process 10 at a time
            .toList();
        
        for (ExportTask task : pending) {
            try {
                task.setStatus("PROCESSING");
                exportTaskRepository.save(task);
                
                byte[] pdf = generatePdf(task);
                sendEmail(pdf);
                
                task.setStatus("DONE");
                task.setProcessedAt(now);
                exportTaskRepository.save(task);
            } catch (Exception e) {
                task.setStatus("FAILED");
                task.setError(e.getMessage());
                exportTaskRepository.save(task);
                // Retry next time
            }
        }
    }
}
```

Lợi:
- No new infrastructure
- Persistent (in MySQL)
- User can check status ("is my export ready?")
- Simple retry (just query PENDING again)

Vấn đề:
- Database load (polling every 1 second)
- Slower than RabbitMQ
- Single server only (unless you do polling + distributed lock)

---

## Practical: Async export ở HMS

Cho HMS của bạn, nếu bạn cần async export, database queue là pragmatic choice:

```java
@PostMapping("/exports/appointments")
public ExportResponse exportAppointments(@RequestBody ExportRequest req, @AuthenticationPrincipal User user) {
    // Validate request
    if (req.getStartDate().isAfter(req.getEndDate())) {
        return new ExportResponse(400, "Invalid date range");
    }
    
    // Create task
    ExportTask task = new ExportTask();
    task.setUserId(user.getId());
    task.setStartDate(req.getStartDate());
    task.setEndDate(req.getEndDate());
    task.setStatus("PENDING");
    task.setCreatedAt(LocalDateTime.now());
    
    exportTaskRepository.save(task);
    
    // Return immediately
    return new ExportResponse(200, "Export queued. Check your email in a few minutes");
}

// Background worker
@Component
public class ExportWorker {
    @Scheduled(fixedRate = 5000)  // Every 5 seconds
    public void processPendingExports() {
        List<ExportTask> pending = exportTaskRepository
            .findByStatusOrderByCreatedAt("PENDING")
            .stream()
            .limit(5)
            .toList();
        
        for (ExportTask task : pending) {
            try {
                task.setStatus("PROCESSING");
                exportTaskRepository.save(task);
                
                List<Appointment> appointments = appointmentRepository
                    .findByUserIdAndDateBetween(
                        task.getUserId(),
                        task.getStartDate(),
                        task.getEndDate()
                    );
                
                byte[] pdf = pdfGenerator.generateAppointmentPdf(appointments);
                emailService.sendWithAttachment(task.getUserId(), pdf, "appointments.pdf");
                
                task.setStatus("DONE");
                task.setProcessedAt(LocalDateTime.now());
                exportTaskRepository.save(task);
            } catch (Exception e) {
                task.setStatus("FAILED");
                task.setError(e.getMessage());
                task.setFailedAt(LocalDateTime.now());
                exportTaskRepository.save(task);
                // Next schedule run sẽ thử lại FAILED tasks
            }
        }
    }
}
```

User có thể check status:

```java
@GetMapping("/exports/{taskId}")
public ExportTaskResponse getExportStatus(@PathVariable Long taskId) {
    ExportTask task = exportTaskRepository.findById(taskId).orElseThrow();
    return new ExportTaskResponse(
        task.getId(),
        task.getStatus(),  // PENDING, PROCESSING, DONE, FAILED
        task.getCreatedAt(),
        task.getProcessedAt(),
        task.getError()
    );
}
```

---

## Cảnh báo: Queue sử dụng sai

**Sai: Dùng queue cho synchronous task**

```java
// ❌ WRONG
@PostMapping("/appointments/book")
public BookingResponse bookAppointment(BookingRequest req) {
    // Put vào queue
    bookingQueue.enqueue(new BookingTask(req));
    // Return immediately
    return new BookingResponse(200, "booking queued");
}
// User không biết booking thành công hay thất bại
```

**Đúng: Queue chỉ cho non-critical, non-synchronous tasks**

```java
// ✅ CORRECT
@PostMapping("/appointments/book")
@Transactional
public BookingResponse bookAppointment(BookingRequest req) {
    // Synchronous — return immediately with result
    Appointment app = appointmentService.book(req);
    return new BookingResponse(200, app);
}

@PostMapping("/appointments/{id}/notify-related")
public NotifyResponse notifyRelated(@PathVariable UUID appointmentId) {
    // Async — non-critical
    notificationQueue.enqueue(new NotifyTask(appointmentId));
    return new NotifyResponse(200, "notifications queued");
}
```

---

## Takeaway

Queue không phải silver bullet. Dùng khi task tốn thời gian + không cần response ngay. Khi bạn introduce queue, bạn introduce complexity: retry logic, failure handling, monitoring.

Cân nhắc trước khi thêm. Database queue là entry point tốt nếu HMS vừa scale.

---

*Bài tiếp theo: Concurrency — khi nhiều request cùng chạm một tài nguyên*
