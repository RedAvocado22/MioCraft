---
title: "Notification gửi trước khi transaction commit — bug thầm lặng nhất"
description: "Gửi email xác nhận đặt lịch, sau đó transaction rollback vì lỗi — user nhận email nhưng lịch không tồn tại. Transactional outbox pattern giải quyết vấn đề này đúng cách."
category: system-design
pubDate: 2024-03-26
series: "Phần 10: Case Studies thực tế"
tags: ["case-study", "transactions", "outbox-pattern", "events"]
---

Bug này không crash hệ thống. Không có exception nào được throw. Log trông bình thường. Nhưng bệnh nhân nhận được SMS xác nhận lịch hẹn — và sau đó gọi lên hỏi tại sao lịch hẹn đó không có trong hệ thống.

Câu trả lời là: transaction rollback sau khi notification đã đi. Notification không biết điều đó.

---

## Code trông ổn nhưng sai hoàn toàn

```java
// ❌ Vấn đề — notification gửi đi trước khi transaction chắc chắn commit
@Service
@RequiredArgsConstructor
public class AppointmentService {

    private final AppointmentRepository appointmentRepository;
    private final NotificationService notificationService;

    @Transactional
    public AppointmentResponse createAppointment(AppointmentRequest request) {
        Appointment appointment = appointmentMapper.toEntity(request);
        appointment = appointmentRepository.save(appointment);

        // Dòng này trông vô hại — chỉ là gửi notification
        // Nhưng lúc này transaction chưa commit
        // Nếu có gì đó fail sau dòng này, transaction rollback
        // Nhưng notification đã bay đi rồi
        notificationService.sendAppointmentConfirmation(appointment);

        // Giả sử đây fail — vd: update schedule counter, audit log, etc.
        updateScheduleSlotCount(appointment.getSchedule());

        return appointmentMapper.toResponse(appointment);
    }
}
```

Flow thực tế khi có lỗi:

```
1. Appointment được save (chưa commit)
2. Notification gửi đi → SMS bay đến điện thoại bệnh nhân ✓
3. updateScheduleSlotCount() throw exception
4. @Transactional rollback → appointment bị xóa khỏi DB
5. Bệnh nhân có SMS nhưng không có lịch hẹn
```

---

## Tại sao @Transactional không bảo vệ được

`@Transactional` wrap toàn bộ method trong một database transaction. Nếu có exception, mọi thay đổi DB đều rollback. Nhưng notification không phải database operation — nó là HTTP call đến một notification service, hoặc direct SMS gateway call. Spring không biết cách "rollback" một cái SMS đã gửi đi.

Đây là vấn đề của **side effects nằm ngoài transaction boundary**. Và notification là ví dụ phổ biến nhất — nhưng không phải duy nhất. Email, webhook, Kafka event, Elasticsearch index update — tất cả đều có thể rơi vào cùng tình huống này.

---

## @TransactionalEventListener — đúng tool cho đúng việc

Spring cung cấp `@TransactionalEventListener` để giải quyết chính xác vấn đề này. Thay vì gọi notification service trực tiếp, service publish một event. Listener sẽ consume event đó — nhưng chỉ **sau khi transaction commit thành công**.

```java
// ✅ Tốt hơn — tách notification ra khỏi business transaction
@Service
@RequiredArgsConstructor
public class AppointmentService {

    private final AppointmentRepository appointmentRepository;
    private final ApplicationEventPublisher eventPublisher;

    @Transactional
    public AppointmentResponse createAppointment(AppointmentRequest request) {
        Appointment appointment = appointmentMapper.toEntity(request);
        appointment = appointmentRepository.save(appointment);

        updateScheduleSlotCount(appointment.getSchedule());

        // Publish event — KHÔNG gửi notification trực tiếp
        // Event này chỉ được xử lý sau khi transaction commit thành công
        eventPublisher.publishEvent(new AppointmentCreatedEvent(appointment));

        return appointmentMapper.toResponse(appointment);
    }
}
```

```java
// Listener chỉ chạy sau khi transaction commit
@Component
@RequiredArgsConstructor
public class AppointmentNotificationListener {

    private final NotificationService notificationService;

    @TransactionalEventListener(phase = TransactionPhase.AFTER_COMMIT)
    public void handleAppointmentCreated(AppointmentCreatedEvent event) {
        // Lúc này transaction đã commit — appointment chắc chắn tồn tại trong DB
        notificationService.sendAppointmentConfirmation(event.getAppointment());
    }
}
```

`TransactionPhase.AFTER_COMMIT` là key ở đây. Spring sẽ giữ event trong một queue tạm thời cho đến khi transaction commit, rồi mới fire listener. Nếu transaction rollback, event bị discard — notification không bao giờ được gửi.

---

## Nhưng AFTER_COMMIT tạo ra vấn đề mới

`@TransactionalEventListener` giải quyết "gửi notification khi chưa commit" — nhưng tạo ra một vấn đề khác: listener chạy sau khi transaction đã đóng.

Nếu listener cần làm gì đó liên quan đến database — vd: log notification history — nó không còn trong transaction gốc nữa. Spring sẽ throw `LazyInitializationException` nếu mày truy cập lazy-loaded field, hoặc không có active transaction để save record.

```java
@Component
@RequiredArgsConstructor
public class AppointmentNotificationListener {

    private final NotificationService notificationService;
    private final NotificationLogRepository notificationLogRepository;

    @TransactionalEventListener(phase = TransactionPhase.AFTER_COMMIT)
    @Transactional(propagation = Propagation.REQUIRES_NEW)
    // ✅ REQUIRES_NEW: tạo transaction MỚI, độc lập với transaction gốc đã commit
    public void handleAppointmentCreated(AppointmentCreatedEvent event) {
        notificationService.sendAppointmentConfirmation(event.getAppointment());

        // Có thể save vào DB trong transaction mới này
        NotificationLog log = NotificationLog.builder()
            .appointmentId(event.getAppointment().getId())
            .type(NotificationType.APPOINTMENT_CONFIRMATION)
            .sentAt(Instant.now())
            .build();

        notificationLogRepository.save(log);
    }
}
```

`Propagation.REQUIRES_NEW` tạo ra một transaction hoàn toàn mới, không liên quan đến transaction gốc. Listener giờ có thể đọc/ghi DB bình thường.

---

## Vẫn còn một failure mode

Ngay cả với `@TransactionalEventListener`, có một trường hợp notification vẫn có thể fail mà không có retry: JVM crash, network blip, notification service temporarily down.

Khi listener chạy và notification service không khả dụng, exception được throw — nhưng không có cơ chế nào để retry tự động. Appointment đã tồn tại trong DB, nhưng bệnh nhân không nhận được thông báo.

Cho use case yêu cầu delivery guarantee cao hơn, HMS dùng outbox pattern:

```java
@Transactional
public AppointmentResponse createAppointment(AppointmentRequest request) {
    Appointment appointment = appointmentMapper.toEntity(request);
    appointment = appointmentRepository.save(appointment);
    updateScheduleSlotCount(appointment.getSchedule());

    // Thay vì publish event, persist vào outbox table TRONG CÙNG TRANSACTION
    // Outbox record và appointment được commit cùng nhau — không bao giờ lệch
    OutboxEvent outboxEvent = OutboxEvent.builder()
        .aggregateId(appointment.getId().toString())
        .eventType("APPOINTMENT_CREATED")
        .payload(objectMapper.writeValueAsString(appointment))
        .status(OutboxStatus.PENDING)
        .build();

    outboxRepository.save(outboxEvent);

    return appointmentMapper.toResponse(appointment);
}
```

```java
// Background job poll outbox và gửi notification với retry
@Scheduled(fixedDelay = 5_000)
@Transactional
public void processOutboxEvents() {
    List<OutboxEvent> pendingEvents = outboxRepository
        .findTop50ByStatusOrderByCreatedAtAsc(OutboxStatus.PENDING);

    for (OutboxEvent event : pendingEvents) {
        try {
            dispatchEvent(event);
            event.setStatus(OutboxStatus.PROCESSED);
        } catch (Exception e) {
            event.incrementRetryCount();
            if (event.getRetryCount() >= MAX_RETRIES) {
                event.setStatus(OutboxStatus.DEAD_LETTER);
                log.error("Outbox event {} moved to dead letter after {} retries",
                    event.getId(), MAX_RETRIES);
            }
        }
        outboxRepository.save(event);
    }
}
```

Outbox pattern đảm bảo at-least-once delivery: notification có thể gửi duplicate trong edge case, nhưng không bao giờ bị drop hoàn toàn. Đây là trade-off phổ biến trong distributed systems — *at-least-once thay vì exactly-once*, và idempotency ở phía receiver sẽ xử lý duplicate.

---

## Takeaway

Bất cứ khi nào mày cần làm gì đó *phụ thuộc vào việc một transaction thành công* — gửi notification, publish event, call external service — đừng bao giờ đặt nó trong cùng transaction mà không dùng `@TransactionalEventListener`. Transaction chưa commit không phải là bảo đảm rằng data sẽ tồn tại. Và một cái notification gửi đi không thể unsend.

---

*Bài tiếp theo: Doctor chỉ thấy bệnh nhân của mình — ABAC implement đúng chỗ hay sai chỗ*
