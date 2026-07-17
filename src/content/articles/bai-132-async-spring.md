---
title: "@Async trong Spring — thread pool và khi transaction không theo"
description: "CompletableFuture trên ThreadPoolTaskExecutor, @EnableAsync, self-invocation, và vì sao @Async trong @Transactional thường không còn transaction."
category: programming
pubDate: 2026-06-02
series: "Phần 7: Backend & Hệ thống"
tags: ["spring", "async", "transaction", "concurrency"]
---

Sau khi đặt lịch thành công, HMS gửi email xác nhận — mất 800ms qua SMTP. User chờ spinner vì dev gọi `mailSender.send()` **trong** request thread. Người có kinh nghiệm gợi ý `@Async`. Người mới thêm annotation, deploy — email vẫn chạy sync. Rồi thêm `@Async` **bên trong** cùng class `AppointmentService` — vẫn sync.

`@Async` trông một dòng. Cơ chế proxy và transaction boundary mới là chỗ hay vấp.

---

## Bật @Async đúng cách

```java
@Configuration
@EnableAsync
public class AsyncConfig {

  @Bean(name = "hmsTaskExecutor")
  public ThreadPoolTaskExecutor hmsTaskExecutor() {
    ThreadPoolTaskExecutor ex = new ThreadPoolTaskExecutor();
    ex.setCorePoolSize(4);
    ex.setMaxPoolSize(16);
    ex.setQueueCapacity(200);
    ex.setThreadNamePrefix("hms-async-");
    ex.initialize();
    return ex;
  }
}
```

```java
@Service
@RequiredArgsConstructor
public class NotificationAsyncService {

  @Async("hmsTaskExecutor")
  public CompletableFuture<Void> sendAppointmentConfirmation(UUID appointmentId) {
    // chạy trên thread pool, không block Tomcat worker
    mailService.sendConfirmation(appointmentId);
    return CompletableFuture.completedFuture(null);
  }
}
```

Gọi từ bean **khác** (controller hoặc `AppointmentService` inject `NotificationAsyncService`):

```java
notificationAsyncService.sendAppointmentConfirmation(appointment.getId());
// không cần .join() nếu fire-and-forget; cần handle exception (xem dưới)
```

---

## Self-invocation — @Async không chạy

Spring `@Async` dùng **proxy**. Gọi `this.sendAsync()` từ trong cùng class → không qua proxy → **sync**.

```java
// ❌ @Async không có hiệu lực
@Service
public class AppointmentService {
  @Transactional
  public void create(...) {
    save(...);
    this.sendEmailAsync(id); // self-invocation
  }

  @Async
  public void sendEmailAsync(UUID id) { ... }
}

// ✅ Gọi qua bean khác
@Service
@RequiredArgsConstructor
public class AppointmentService {
  private final NotificationAsyncService notifications;

  @Transactional
  public void create(...) {
    save(...);
    notifications.sendAppointmentConfirmation(id);
  }
}
```

---

## @Async + @Transactional — transaction không đi theo thread

`@Transactional` gắn transaction vào **thread hiện tại** (ThreadLocal). `@Async` chuyển sang thread pool khác — thread mới **không có transaction context của caller**. Async có thể bắt đầu trước khi caller commit xong, hoặc sau — dù sao cũng không share transaction.

```java
// ❌ Nghĩ async vẫn “trong” transaction create appointment
@Transactional
public void create(AppointmentRequest req) {
  appointmentRepository.save(entity);
  asyncService.writeAuditLog(entity.getId()); // thread khác — không thấy uncommitted row (tùy isolation) hoặc race
}
```

Hệ quả thường gặp:

- Async đọc DB **trước khi** transaction commit → không thấy row mới → log “not found”
- Async ghi DB ngoài transaction chính → cần `@Transactional(propagation = REQUIRES_NEW)` **trên method async** nếu muốn ghi độc lập

Notification/email sau booking: dùng `@TransactionalEventListener(phase = AFTER_COMMIT)` (bài 85) thay vì `@Async` ngay giữa transaction — đảm bảo chỉ chạy khi data đã commit.

```java
@TransactionalEventListener(phase = TransactionPhase.AFTER_COMMIT)
@Async("hmsTaskExecutor")
public void onAppointmentCreated(AppointmentCreatedEvent event) {
  mailService.sendConfirmation(event.appointmentId());
}
```

---

## Exception và CompletableFuture

Exception trên thread async **không** tự bubble lên HTTP response nếu fire-and-forget. Cần:

- `AsyncUncaughtExceptionHandler` log + metric
- Hoặc caller `.exceptionally()` / `whenComplete` nếu dùng `CompletableFuture` return

Đừng `@Async` mọi thứ — queue (bài 65) khi cần durability, retry, backpressure. `@Async` phù hợp “best effort nhanh, mất thì chấp nhận hoặc log”.

---

## Takeaway

`@Async` qua bean riêng + `@EnableAsync` + pool có tên. Không gọi async trong cùng class. Không kỳ vọng transaction của caller bọc async — sau commit thì event listener hoặc transaction mới trên async method.

---

*Bài tiếp theo: Bulk import CSV bệnh nhân — batch, validation, error report*
