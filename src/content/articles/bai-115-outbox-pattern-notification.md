---
title: "Outbox pattern — email không mất sau commit"
description: "AFTER_COMMIT vẫn fail nếu process chết trước khi gửi mail. Ghi outbox trong cùng transaction DB, worker gửi sau — at-least-once có kiểm soát."
category: system-design
pubDate: 2026-06-02
series: "Phần 10: Case Studies thực tế"
tags: ["case-study", "outbox", "transaction", "notification"]
---


Bài 85 nói: đừng gửi notification **trong** transaction — dùng `@TransactionalEventListener(AFTER_COMMIT)`. Đúng hướng.

Nhưng production vẫn có ticket: *"Appointment đã CONFIRMED trong DB, patient không nhận email."* Log không có exception lúc book. SMTP timeout một giây sau commit, hoặc pod **SIGKILL** ngay sau khi transaction commit, trước khi listener chạy xong.

AFTER_COMMIT = *"chỉ gửi sau khi data chắc chắn persist"*. Không đảm bảo *"gửi thành công"*.

Outbox pattern đóng khoảng trống đó.

---

## Vấn đề: side effect và transaction không cùng fate

```java
// ❌ Vẫn có thể mất message
@TransactionalEventListener(phase = TransactionPhase.AFTER_COMMIT)
public void onBooked(AppointmentBookedEvent event) {
  emailService.sendConfirmation(event.appointmentId()); // fail = mất, không replay tự động
}
```

Email API là hệ thống khác. Không rollback được DB nếu email fail — và không nên rollback appointment vì email hỏng.

Cần: **intent gửi email** được lưu cùng fate với appointment — cùng commit DB.

---

## Outbox: một transaction, hai insert

```java
@Entity
public class OutboxEvent {
  @Id
  private UUID id;
  private String aggregateType;   // "Appointment"
  private UUID aggregateId;
  private String eventType;       // "BOOKED"
  private String payload;         // JSON
  @Enumerated(EnumType.STRING)
  private OutboxStatus status;    // PENDING, SENT, FAILED
  private Instant createdAt;
}
```

```java
@Transactional
public AppointmentResponse book(CreateAppointmentRequest req) {
  var appointment = /* save appointment */;

  outboxRepository.save(new OutboxEvent(
      UUID.randomUUID(),
      "Appointment",
      appointment.getId(),
      "BOOKED",
      objectMapper.writeValueAsString(new AppointmentBookedPayload(appointment.getId(), appointment.getPatientEmail())),
      OutboxStatus.PENDING,
      Instant.now()
  ));

  return mapper.toResponse(appointment);
  // commit: appointment + outbox cùng lúc hoặc cùng rollback
}
```

Sau commit, **worker** (scheduled hoặc polling) đọc `PENDING`, gửi email, mark `SENT`:

```java
@Scheduled(fixedDelay = 5000)
@Transactional
public void processOutbox() {
  var events = outboxRepository.findTop100ByStatusOrderByCreatedAt(OutboxStatus.PENDING);
  for (var event : events) {
    try {
      dispatch(event);
      event.setStatus(OutboxStatus.SENT);
    } catch (Exception ex) {
      event.setStatus(OutboxStatus.FAILED);
      log.error("Outbox failed {}", event.getId(), ex);
    }
  }
}
```

Pod chết giữa chừng — event vẫn `PENDING`, instance khác pick up lại.

---

## At-least-once và idempotency

Worker có thể gửi email **hai lần** nếu crash sau send nhưng trước mark SENT. Email provider hoặc consumer phải **idempotent** — subject kèm `appointmentId`, hoặc check dedup table.

Nối với bài 84: idempotency key không chỉ cho payment, cả notification.

---

## Outbox vs message queue

| | Outbox + poll | Rabbit/Kafka ngay sau commit |
|--|---------------|------------------------------|
| Độ phức tạp | Thấp — chỉ thêm bảng | Cao — broker, consumer |
| Đảm bảo | Transactional với DB | Cần transactional outbox hoặc CDC anyway |
| Scale | Đủ cho HMS phase 1 | Khi event volume lớn |

Nhiều team HMS phase 1: outbox table + `@Scheduled` là đủ. Sau này Debezium CDC từ outbox sang Kafka nếu cần.

---

## Không nhồi mọi thứ vào outbox

Chỉ **side effect bắt buộc phải xảy ra** sau business fact: email confirmation, SMS, push FCM, webhook đối tác. Đừng outbox cho "invalidate cache" nếu có cách đơn giản hơn (TTL ngắn).

---

## Takeaway

AFTER_COMMIT giải quyết *thứ tự* (không gửi mail trước commit). Outbox giải quyết *độ bền* (intent survive crash). Cùng transaction: `appointment` + `outbox_event`. Worker gửi sau, idempotent. Đó là cách email "đã đặt lịch" không biến mất im lặng.

---

*Bài tiếp theo: Payment webhook — signature và idempotent.*
