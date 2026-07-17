---
title: "State machine thanh toán — cancel đã trả tiền và refund"
description: "Boolean isPaid + isCancelled dễ lệch. Enum trạng thái, transition hợp lệ, và refund chỉ khi payment đã CAPTURED — tránh free slot và double refund."
category: system-design
pubDate: 2026-05-29
series: "Phần 10: Case Studies thực tế"
tags: ["case-study", "state-machine", "payment", "refund"]
---

Bệnh nhân hủy lịch sau khi đã thanh toán online. Support hỏi: *"Tiền hoàn khi nào?"* Dev mở DB thấy `isCancelled=true`, `isPaid=true`, `refundStatus` null — không ai trong team chắc job refund đã chạy hay chưa.

Đó là hậu quả của **trạng thái ngầm** trong vài cột boolean. Production cần **state machine** rõ: appointment biết đang ở đâu; payment biết đã capture chưa; refund là transition riêng, không phải `if` rải rác.

---

## Hai aggregate, đừng trộn một enum

**AppointmentStatus** — vòng đời khám:

`DRAFT` → `PENDING_PAYMENT` → `CONFIRMED` → `COMPLETED` / `CANCELLED` / `NO_SHOW`

**PaymentStatus** — vòng đời tiền (orthogonal):

`INITIATED` → `AUTHORIZED` → `CAPTURED` → `REFUND_PENDING` → `REFUNDED` / `FAILED`

Webhook gateway (bài 116) là **source of truth** cho `CAPTURED`. Client không được nhảy `CONFIRMED` chỉ vì UI báo success.

---

## Transition hợp lệ trong code

```java
public enum AppointmentStatus {
  DRAFT, PENDING_PAYMENT, CONFIRMED, COMPLETED, CANCELLED, NO_SHOW;

  private static final Map<AppointmentStatus, Set<AppointmentStatus>> ALLOWED = Map.of(
      PENDING_PAYMENT, Set.of(CONFIRMED, CANCELLED),
      CONFIRMED, Set.of(COMPLETED, CANCELLED, NO_SHOW),
      COMPLETED, Set.of(),
      CANCELLED, Set.of()
  );

  public void assertCanTransitionTo(AppointmentStatus next) {
    if (!ALLOWED.getOrDefault(this, Set.of()).contains(next)) {
      throw new BusinessException("INVALID_STATUS_TRANSITION");
    }
  }
}
```

```java
@Transactional
public void cancelAfterPayment(UUID appointmentId, String reason) {
  var appointment = appointmentRepository.findByIdForUpdate(appointmentId) // @Lock(PESSIMISTIC_WRITE) + @Query trong repository
      .orElseThrow(() -> new NotFoundException("APPOINTMENT_NOT_FOUND"));

  appointment.getStatus().assertCanTransitionTo(AppointmentStatus.CANCELLED);

  var payment = paymentRepository.findByAppointmentId(appointmentId)
      .orElseThrow(() -> new NotFoundException("PAYMENT_NOT_FOUND"));

  if (payment.getStatus() != PaymentStatus.CAPTURED) {
    throw new BusinessException("PAYMENT_NOT_CAPTURED");
  }

  payment.getStatus().assertCanTransitionTo(PaymentStatus.REFUND_PENDING); // PaymentStatus cần cùng pattern ALLOWED map như AppointmentStatus
  payment.setStatus(PaymentStatus.REFUND_PENDING);
  appointment.setStatus(AppointmentStatus.CANCELLED);
  appointment.setCancellationReason(reason);

  refundService.enqueueRefund(payment.getGatewayPaymentId(), payment.getAmount());
  // Outbox gửi email hủy — bài 115
}
```

`findByIdForUpdate` (hoặc optimistic `@Version` bài 114) — hai tab cùng cancel không double enqueue refund.

---

## Refund: async và idempotent

Gateway refund API **có thể retry**. Gọi trực tiếp trong HTTP request cancel = timeout + user không biết đã hủy chưa.

```java
@Transactional
public void processRefundJob(UUID paymentId) {
  var payment = paymentRepository.findById(paymentId).orElseThrow();

  if (payment.getStatus() == PaymentStatus.REFUNDED) {
    return; // đã xong — idempotent
  }
  if (payment.getStatus() != PaymentStatus.REFUND_PENDING) {
    throw new IllegalStateException("Unexpected payment status for refund");
  }

  var result = paymentGatewayClient.refund(
      payment.getGatewayPaymentId(),
      payment.getAmount(),
      payment.getRefundIdempotencyKey() // UUID generate lúc enqueue, reuse mỗi retry
  );

  if (result.succeeded()) {
    payment.setStatus(PaymentStatus.REFUNDED);
  } else {
    payment.setStatus(PaymentStatus.FAILED); // alert + manual
  }
}
```

`refundIdempotencyKey` cố định cho một lần hoàn tiền — retry job không tạo hoàn hai lần (chi tiết outbound bài 126).

---

## Webhook + cancel cùng lúc

User cancel trong lúc webhook `SUCCESS` đến — hai luồng đụng một payment. Rule:

- Chỉ một luồng thắng `SELECT ... FOR UPDATE` trên payment row
- Transition luôn qua `assertCanTransitionTo`
- Nếu đã `REFUND_PENDING`, webhook late `CAPTURED` → log anomaly, không confirm appointment

---

## Takeaway

Hủy lịch đã trả tiền = transition appointment `CANCELLED` **và** payment `REFUND_PENDING` → job refund idempotent. Không thêm boolean `needRefund`. Vẽ diagram transition trước khi viết `if` — người mới đọc được, prod ít scandal hoàn tiền.

---

*Bài tiếp theo: Postmortem — sau incident, học hệ thống không đổ lỗi người*
