---
title: "Payment webhook — signature verify và idempotent"
description: "Gateway gọi ngược POST /webhooks/payment — không tin body, verify HMAC, xử lý trùng eventId. Cặp đôi với idempotency key phía client."
category: system-design
pubDate: 2026-06-03
series: "Phần 10: Case Studies thực tế"
tags: ["case-study", "payment", "webhook", "security"]
---


Client gửi `POST /payments` với idempotency key — bài 84. Payment gateway xử lý xong, gọi ngược:

```
POST https://api.hms.example.com/webhooks/payment
{ "eventId": "evt_abc", "paymentId": "pay_xyz", "status": "SUCCESS", ... }
```

Junior expose endpoint `permitAll`, update appointment status từ body, trả 200. Attacker POST fake `SUCCESS` — appointment free.

Webhook không phải API cho frontend. Là **cửa sau** — chỉ gateway được vào, và có thể gọi **nhiều lần**.

---

## Không tin body — verify signature

Gateway ký payload bằng shared secret hoặc public key:

```java
@PostMapping("/webhooks/payment")
public ResponseEntity<Void> handlePaymentWebhook(
    @RequestBody String rawBody,
    @RequestHeader("X-Signature") String signature) {

  if (!paymentWebhookVerifier.isValid(rawBody, signature)) {
    log.warn("Invalid webhook signature");
    return ResponseEntity.status(HttpStatus.UNAUTHORIZED).build();
  }

  var event = objectMapper.readValue(rawBody, PaymentWebhookEvent.class);
  paymentWebhookService.process(event);
  return ResponseEntity.ok().build();
}
```

```java
public boolean isValid(String rawBody, String signatureHeader) {
  String expected = HmacUtils.hmacSha256Hex(webhookSecret, rawBody);
  return MessageDigest.isEqual(
      expected.getBytes(StandardCharsets.UTF_8),
      signatureHeader.getBytes(StandardCharsets.UTF_8));
}
```

Dùng **raw body** — parse JSON trước khi verify là sai vì whitespace/format thay đổi chữ ký.

Secret trong env (`PAYMENT_WEBHOOK_SECRET`), không hardcode.

---

## Idempotent theo `eventId`

Gateway retry webhook khi không nhận 200 — cùng `eventId` tới 3 lần.

```java
@Entity
@Table(uniqueConstraints = @UniqueConstraint(columnNames = "externalEventId"))
public class ProcessedWebhookEvent {
  @Id
  private UUID id;
  private String externalEventId;
  private Instant processedAt;
}

@Transactional
public void process(PaymentWebhookEvent event) {
  if (processedWebhookRepository.existsByExternalEventId(event.eventId())) {
    return; // đã xử lý — trả 200 im lặng
  }

  var payment = paymentRepository.findByGatewayPaymentId(event.paymentId())
      .orElseThrow(() -> new NotFoundException("PAYMENT_NOT_FOUND"));

  if (event.status() == PaymentStatus.SUCCESS) {
    payment.markPaid();
    appointmentService.confirmAfterPayment(payment.getAppointmentId());
  }

  try {
    processedWebhookRepository.save(new ProcessedWebhookEvent(event.eventId()));
  } catch (DataIntegrityViolationException ignored) {
    // race condition: hai request cùng vượt qua existsBy check — unique constraint bắt, bỏ qua
  }
}
```

Unique constraint trên `externalEventId` — race hai request song song: một thắng, một bị bắt bởi `DataIntegrityViolationException` → coi như đã xử lý.

---

## Trả 200 nhanh vs xử lý nặng

Nếu `confirmAfterPayment` gọi nhiều hệ thống — queue nội bộ hoặc outbox (bài 115), webhook handler chỉ validate + persist event + enqueue, trả 200. Tránh gateway timeout retry storm.

---

## Phân biệt với client callback

| | Client POST /payments | Gateway webhook |
|--|----------------------|-----------------|
| Auth | JWT user | HMAC signature |
| Idempotency | `Idempotency-Key` header | `eventId` unique |
| Ai gửi | Browser/app user | Server gateway |

Cả hai có thể cập nhật cùng appointment — thiết kế state machine: chỉ `PENDING_PAYMENT` → `CONFIRMED` khi có bằng chứng thanh toán từ webhook (source of truth), không tin client tự báo "đã trả".

---

## Takeaway

Webhook = untrusted internet cho đến khi verify signature. Mọi event xử lý idempotent bằng `eventId`. Secret trong env. Và đừng `permitAll` rồi quên — đó là free appointment vulnerability.

---

*Bài tiếp theo: Cron job — ShedLock khi hai instance chạy scheduled task.*
