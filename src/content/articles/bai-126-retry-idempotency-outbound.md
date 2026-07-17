---
title: "Retry outbound và idempotency — khi HMS gọi gateway"
description: "P10/Bài 02 nói về idempotency inbound. Outbound: RestClient timeout, @Retryable chỉ trên read hoặc request có Idempotency-Key — tránh capture hai lần."
category: system-design
pubDate: 2026-05-29
series: "Phần 10: Case Studies thực tế"
tags: ["retry", "idempotency", "resilience", "integration"]
---

Client gửi `Idempotency-Key` — bài 84 — HMS xử lý đúng một lần. Xong service gọi `paymentGateway.capture(...)` — **timeout**. Không biết gateway đã capture chưa. `@Retryable` bắn lần hai → **double capture**.

Inbound idempotency không cứu outbound. Hai chiều, hai thiết kế.

---

## Retry chỉ an toàn khi operation idempotent

**An toàn retry (hoặc có key):**

- `GET` trạng thái payment
- `POST capture` **kèm** `Idempotency-Key` header gateway hỗ trợ
- Refund với cùng `refundIdempotencyKey` (bài 123)

**Không blind retry:**

- `POST` tạo payment mới không key
- Transfer tiền không idempotency

Rule: *Nếu không chắc lần 1 đã thành công, đừng retry cùng payload — hỏi trạng thái trước.*

---

## Outbound client với key cố định

```java
@Service
public class PaymentGatewayClient {

  private final RestClient restClient;

  public CaptureResult capture(String gatewayPaymentId, BigDecimal amount, UUID idempotencyKey) {
  return restClient.post()
      .uri("/v1/payments/{id}/capture", gatewayPaymentId)
      .header("Idempotency-Key", idempotencyKey.toString())
      .body(new CaptureRequest(amount))
      .retrieve()
      .body(CaptureResult.class);
  }
}
```

`idempotencyKey` lưu trên `Payment` entity lúc tạo — mọi retry job dùng **cùng UUID**, không random mỗi lần.

---

## Timeout + recovery flow

```java
@Transactional
public void capturePayment(UUID paymentId) {
  var payment = paymentRepository.findByIdForUpdate(paymentId).orElseThrow(); // @Lock(PESSIMISTIC_WRITE) + @Query trong repository

  if (payment.getStatus() == PaymentStatus.CAPTURED) {
    return;
  }

  try {
    var result = gatewayClient.capture(
        payment.getGatewayPaymentId(),
        payment.getAmount(),
        payment.getCaptureIdempotencyKey());

    payment.markCaptured(result);
  } catch (ResourceAccessException ex) {
    // timeout / connection reset — chưa biết kết quả
    payment.setStatus(PaymentStatus.CAPTURE_UNKNOWN);
    reconciliationQueue.enqueue(paymentId);
    throw ex;
  }
}
```

Job reconciliation:

```java
public void reconcile(UUID paymentId) {
  var payment = paymentRepository.findById(paymentId).orElseThrow();
  var remote = gatewayClient.getPayment(payment.getGatewayPaymentId());

  if (remote.status() == GatewayStatus.CAPTURED) {
    payment.markCapturedFromRemote(remote);
  } else if (remote.status() == GatewayStatus.AUTHORIZED) {
    capturePayment(paymentId); // retry capture với CÙNG idempotency key
  }
}
```

**Reconcile trước, retry sau** — tránh duplicate side effect.

---

## Resilience4j Retry — cấu hình có ý thức

```java
RetryConfig config = RetryConfig.custom()
    .maxAttempts(3)
    .waitDuration(Duration.ofMillis(500))
    .retryExceptions(ResourceAccessException.class)
    .ignoreExceptions(BusinessException.class)
    .build();
```

Chỉ wrap method **đã idempotent** hoặc đã gắn key. `retryExceptions` không bao gồm `HttpClientErrorException 4xx` — lỗi client fix code, retry vô ích.

Circuit breaker (bài 73) kết hợp: gateway down liên tục → fail fast, không pile thread chờ timeout.

---

## At-least-once nội bộ (queue)

Worker consume message **at-least-once** — handler gọi gateway phải idempotent (bài 80, 115). Cùng `paymentId` xử lý hai lần → cùng kết quả.

---

## Đối chiếu inbound vs outbound

| Hướng | Ai retry | Cơ chế |
|-------|----------|--------|
| Inbound | Client/browser | `Idempotency-Key` header → DB unique (84) |
| Inbound webhook | Gateway | `eventId` unique (116) |
| Outbound | HMS / scheduler | Gateway idempotency key + reconcile |

---

## Takeaway

Mỗi lần thêm `RestClient` gọi hệ thống ngoài: viết ra *"Timeout thì sao? Retry có double charge không?"* Nếu có — idempotency key persist trên entity + reconcile job. `@Retryable` tiện nhưng nguy hiểm khi quên chiều outbound.

---

*Bài tiếp theo: Soft delete leak — data đã xóa vẫn lọt ra API*
