---
title: "User bấm thanh toán 2 lần — idempotency key hoạt động ra sao"
description: "Network timeout, user double-click, retry logic — tất cả đều có thể gây ra duplicate payment. Idempotency key đảm bảo cùng một request chỉ được xử lý đúng một lần."
category: system-design
pubDate: 2024-03-25
series: "Phần 10: Case Studies thực tế"
tags: ["case-study", "idempotency", "payments", "distributed-systems"]
---

Có một loại bug đặc biệt khó chịu: bug mà user tạo ra không phải vì dùng sai, mà vì dùng đúng — chỉ là nhanh hơn mức hệ thống expect.

Bệnh nhân thanh toán viện phí, bấm xác nhận, mạng chậm, không thấy phản hồi, bấm lại. Server xử lý cả hai request. Tài khoản bị trừ hai lần. Bệnh nhân gọi lên complain. Bộ phận kế toán phải hoàn tiền thủ công. Mọi người mất thời gian.

Đây không phải lỗi của user. Đây là lỗi thiết kế — và idempotency key là cách hệ thống làm đúng.

---

## Tại sao retry là tất yếu

Trong một distributed system — thậm chí trong một web app đơn giản — network không đáng tin cậy. Request có thể timeout. User có thể impatient và bấm lại. Client-side code có thể implement auto-retry. Load balancer có thể re-route request đến server khác khi server đầu không phản hồi kịp.

Vấn đề là: server đầu tiên *đã* xử lý xong và đã trừ tiền — nó chỉ không kịp trả response trước khi connection bị đóng. Server nhận retry không biết điều này và xử lý lại từ đầu.

**Idempotency** nghĩa là: gọi cùng một operation nhiều lần có kết quả giống như gọi một lần. Đây là property mà payment endpoint — và bất kỳ operation nào có side effect quan trọng — phải có.

---

## Idempotency key là gì và nó đến từ đâu

Idempotency key là một định danh duy nhất được gắn vào một specific request. Nếu request đó được gửi lại, server nhận ra nó đã được xử lý trước đó và trả về kết quả cũ thay vì xử lý lại.

Key này thường do **client** generate — không phải server. Tại sao? Vì server không biết request nào là retry của request nào. Client mới biết "tao đang gửi lại cái này vì tao chưa nhận được response."

```java
// Client gửi request với idempotency key trong header
POST /api/payments
Idempotency-Key: a7f3c2d1-9b4e-4f8a-b3c7-2e1d9f4a6b8c
Content-Type: application/json

{
  "appointmentId": "abc-123",
  "amount": 500000,
  "method": "BANK_TRANSFER"
}
```

Client generate UUID này một lần cho mỗi *intent* thanh toán, không phải mỗi HTTP request. Nếu request fail hoặc timeout, client gửi lại cùng UUID đó. Server dùng UUID này để detect duplicate.

---

## Implement trong HMS

```java
@Service
@RequiredArgsConstructor
public class PaymentService {

    private final PaymentRepository paymentRepository;
    private final IdempotencyKeyRepository idempotencyKeyRepository;
    private final RedisTemplate<String, String> redisTemplate;

    @Transactional
    public PaymentResponse processPayment(
        PaymentRequest request,
        String idempotencyKey,
        UUID userId
    ) {
        // Bước 1: Check xem key này đã được dùng chưa
        // Dùng Redis để fast-check trước khi query DB
        String cacheKey = "idempotency:payment:" + idempotencyKey;
        String cachedResult = redisTemplate.opsForValue().get(cacheKey);

        if (cachedResult != null) {
            // Request này đã được xử lý — trả về kết quả cũ, không process lại
            return objectMapper.readValue(cachedResult, PaymentResponse.class);
        }

        // Bước 2: Check DB để handle trường hợp Redis expire nhưng DB vẫn còn record
        Optional<IdempotencyRecord> existingRecord = idempotencyKeyRepository
            .findByKeyAndUserId(idempotencyKey, userId);

        if (existingRecord.isPresent()) {
            // Warm lại cache và trả về kết quả cũ
            cacheIdempotencyResult(cacheKey, existingRecord.get().getResponseBody());
            return objectMapper.readValue(
                existingRecord.get().getResponseBody(),
                PaymentResponse.class
            );
        }

        // Bước 3: Key chưa từng được dùng — xử lý payment thật
        // Validate payment trước khi làm gì khác
        Appointment appointment = appointmentRepository
            .findById(request.getAppointmentId())
            .orElseThrow(() -> new NotFoundException("Appointment not found"));

        validatePaymentEligibility(appointment, request, userId);

        // Bước 4: Tạo payment record
        Payment payment = Payment.builder()
            .appointment(appointment)
            .amount(request.getAmount())
            .method(request.getMethod())
            .status(PaymentStatus.PROCESSING)
            .idempotencyKey(idempotencyKey)
            .build();

        payment = paymentRepository.save(payment);

        // Bước 5: Persist idempotency record — làm điều này TRƯỚC khi external call
        // Nếu external call fail, record vẫn ở đây để xử lý compensation
        PaymentResponse response = callPaymentGateway(payment);

        payment.setStatus(PaymentStatus.COMPLETED);
        payment.setGatewayTransactionId(response.getTransactionId());
        paymentRepository.save(payment);

        // Bước 6: Lưu idempotency record sau khi thành công
        String responseBody = objectMapper.writeValueAsString(response);
        saveIdempotencyRecord(idempotencyKey, userId, responseBody);
        cacheIdempotencyResult(cacheKey, responseBody);

        return response;
    }

    private void saveIdempotencyRecord(
        String key,
        UUID userId,
        String responseBody
    ) {
        IdempotencyRecord record = IdempotencyRecord.builder()
            .key(key)
            .userId(userId)
            .responseBody(responseBody)
            .createdAt(Instant.now())
            .expiresAt(Instant.now().plus(24, ChronoUnit.HOURS))
            .build();

        idempotencyKeyRepository.save(record);
    }

    private void cacheIdempotencyResult(String cacheKey, String responseBody) {
        // Cache 1 giờ — đủ để cover retry window thực tế
        redisTemplate.opsForValue().set(cacheKey, responseBody, Duration.ofHours(1));
    }
}
```

---

## Một edge case nguy hiểm: concurrent duplicate requests

Idempotency check ở trên có một vấn đề tinh tế: nếu hai request với cùng idempotency key đến *cùng một lúc* — trước khi request đầu tiên kịp lưu record xuống DB — cả hai đều pass qua bước check và cùng xử lý payment.

Đây là classic TOCTOU (Time-of-Check to Time-of-Use) vấn đề. Giải pháp là dùng database unique constraint kết hợp với optimistic concurrency:

```java
// Entity với unique constraint
@Entity
@Table(
    name = "idempotency_records",
    uniqueConstraints = @UniqueConstraint(
        columnNames = {"idempotency_key", "user_id"}
        // ✅ Database đảm bảo không bao giờ có 2 record cùng key + user
    )
)
public class IdempotencyRecord {
    @Column(name = "idempotency_key", nullable = false)
    private String key;

    @Column(name = "user_id", nullable = false)
    private UUID userId;

    @Column(name = "response_body", columnDefinition = "TEXT")
    private String responseBody;

    // ...
}
```

```java
// Trong service: bắt exception từ unique constraint violation
try {
    saveIdempotencyRecord(idempotencyKey, userId, responseBody);
} catch (DataIntegrityViolationException e) {
    // Race condition: request khác đã lưu record này rồi
    // Query lại và trả về kết quả của request đó
    return idempotencyKeyRepository
        .findByKeyAndUserId(idempotencyKey, userId)
        .map(record -> objectMapper.readValue(record.getResponseBody(), PaymentResponse.class))
        .orElseThrow(() -> new InternalException("Idempotency record inconsistency"));
}
```

Database unique constraint là safety net cuối cùng. Ngay cả khi application-level check bị bypass do race condition, DB vẫn đảm bảo chỉ một record được insert.

---

## Idempotency key không phải chỉ cho payment

Pattern này apply cho bất kỳ operation nào có side effect không nên xảy ra hai lần:

- Gửi email/SMS confirmation — user không muốn nhận 2 tin
- Tạo appointment — tương tự slot booking problem ở bài trước
- Dispatch event sang external system — downstream không expect duplicate

Rule of thumb: nếu operation mày đang viết là **non-idempotent by nature** (tức là gọi hai lần có kết quả khác gọi một lần), mày cần một mechanism để detect và deduplicate retry. Idempotency key là mechanism phổ biến nhất.

---

## Takeaway

Lần tới khi viết một endpoint xử lý payment, booking, hay bất kỳ thứ gì có side effect quan trọng — hãy hỏi: *"Điều gì xảy ra nếu request này được gửi hai lần?"* Nếu câu trả lời là "bad things happen", thì đó là lúc cần idempotency key, không phải sau khi user report duplicate charge.

---

*Bài tiếp theo: Notification gửi trước khi transaction commit — bug thầm lặng nhất*
