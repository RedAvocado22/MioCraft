---
title: "Circuit Breaker — vì sao một service chậm có thể kéo sập cả hệ thống"
description: "3 trạng thái Closed/Open/Half-Open, khi nào trip, khi nào reset, fallback strategy với Resilience4j + Spring Boot."
category: system-design
pubDate: 2026-06-21
series: "Phần 8: System Design"
tags: ["circuit-breaker", "resilience4j", "fault-tolerance", "system-design", "spring-boot"]
---

Load balancer biết server nào chết hẳn — không ping được, stop routing. Nhưng "chết hẳn" hiếm hơn bạn tưởng. Thường thì server vẫn sống, vẫn nhận request, chỉ là **đang xử lý cực chậm** vì quá tải hoặc dependency downstream bị nghẽn.

Trong HMS, `AppointmentService` gọi sang một external service để gửi SMS xác nhận lịch hẹn. External service đó bắt đầu timeout — mỗi call phải chờ 30 giây mới fail. Không có gì báo là service đó đang chết. Load balancer vẫn route bình thường.

Kết quả: mỗi request đặt lịch giữ một thread Spring Boot trong 30 giây. Thread pool cạn dần. Tất cả request — kể cả những request không liên quan gì đến SMS — bắt đầu bị queue, rồi fail. HMS sập theo kiểu domino từ một service SMS mà ra.

Đây là **cascading failure**, và Circuit Breaker là cái ngăn nó lan.

---

## Circuit Breaker hoạt động như thế nào

Cái tên lấy từ điện — cầu dao ngắt mạch khi quá tải để bảo vệ hệ thống. Khái niệm tương tự: nếu một đoạn code đang fail liên tục, **đừng tiếp tục gọi nó**, fail nhanh và trả về fallback.

Ba trạng thái:

**Closed** — bình thường. Request đi qua, Circuit Breaker chỉ đếm số lần fail. Dưới ngưỡng thì không làm gì.

**Open** — đã trip. Fail quá ngưỡng cấu hình. Mọi request tiếp theo **không gọi service thật** — fail ngay lập tức, không chờ timeout. Thread không bị giữ. Sau một khoảng thời gian (`waitDurationInOpenState`), chuyển sang Half-Open để thử lại.

**Half-Open** — đang thăm dò. Cho phép một số request nhỏ đi qua để kiểm tra service đã hồi phục chưa. Nếu pass — về Closed. Nếu fail — về Open.

```
     [quá ngưỡng fail]          [thử lại fail]
Closed ──────────────→ Open ←──────────────── Half-Open
  ↑                      │                        │
  │    [hết wait time]   │    [thử lại thành công]│
  └──────────────────────┘◄───────────────────────┘
```

---

## Cài Resilience4j vào HMS

```xml
<!-- pom.xml -->
<dependency>
    <groupId>io.github.resilience4j</groupId>
    <artifactId>resilience4j-spring-boot3</artifactId>
    <!-- version quản lý bởi Spring Boot BOM -->
</dependency>
```

Config trong `application.yml`:

```yaml
resilience4j:
  circuitbreaker:
    instances:
      smsService:
        # Tính failure rate theo sliding window 10 call gần nhất
        sliding-window-size: 10
        sliding-window-type: COUNT_BASED

        # Trip khi failure rate >= 50% trong sliding window
        failure-rate-threshold: 50

        # Số call tối thiểu cần có trước khi tính failure rate
        # (tránh trip sau 1 fail đầu tiên)
        minimum-number-of-calls: 5

        # Thời gian giữ Open state trước khi sang Half-Open
        wait-duration-in-open-state: 30s

        # Số call thử nghiệm trong Half-Open state
        permitted-number-of-calls-in-half-open-state: 3

        # Coi exception nào là failure
        # Mặc định: tất cả exception đều là failure
        record-exceptions:
          - java.io.IOException
          - java.util.concurrent.TimeoutException
          - feign.RetryableException
```

---

## Code thực tế trong HMS

`AppointmentService` gọi SMS service qua Feign client:

```java
@Service
@RequiredArgsConstructor
public class AppointmentService {

    private final SmsClient smsClient;
    private final AppointmentRepository appointmentRepository;

    @Transactional
    public AppointmentResponse createAppointment(CreateAppointmentRequest req) {
        // ... validate slot, create appointment
        Appointment saved = appointmentRepository.save(appointment);

        // Gửi SMS xác nhận — nhưng SMS fail không được làm booking fail
        sendConfirmationSms(saved);

        return mapper.toResponse(saved);
    }

    // @CircuitBreaker wrap call này, không wrap cả createAppointment
    @CircuitBreaker(name = "smsService", fallbackMethod = "sendConfirmationSmsFallback")
    private void sendConfirmationSms(Appointment appointment) {
        smsClient.send(SmsRequest.builder()
            .to(appointment.getPatientPhone())
            .message("Lịch hẹn " + appointment.getDateTime() + " đã được xác nhận.")
            .build());
    }

    // Fallback: log và để async job retry sau, không throw exception
    private void sendConfirmationSmsFallback(Appointment appointment, Exception ex) {
        log.warn("SMS service unavailable for appointment {}, scheduled retry. Cause: {}",
            appointment.getId(), ex.getMessage());
        // Đưa vào retry queue — implement tùy use case
        smsRetryRepository.save(SmsRetryJob.of(appointment.getId()));
    }
}
```

Vài điểm quan trọng trong code này:

`@CircuitBreaker` đặt trên `sendConfirmationSms`, **không phải** trên `createAppointment`. Nếu đặt trên method cha, fallback sẽ trả về cả `AppointmentResponse` từ fallback — logic sai. SMS fail không có nghĩa là booking fail.

Fallback method phải có **cùng signature** cộng thêm một parameter `Exception` ở cuối. Resilience4j gọi đúng fallback dựa trên signature này.

`private` method không hoạt động với `@CircuitBreaker` nếu dùng Spring AOP proxy — giống `@Transactional` (bài 106). Trong thực tế, tách `SmsService` thành bean riêng và inject vào `AppointmentService` là cách sạch hơn.

---

## Tách SmsService ra bean riêng — đúng hơn

```java
@Service
@RequiredArgsConstructor
public class SmsService {

    private final SmsClient smsClient;
    private final SmsRetryRepository smsRetryRepository;

    @CircuitBreaker(name = "smsService", fallbackMethod = "sendFallback")
    public void send(String phone, String message) {
        smsClient.send(SmsRequest.builder()
            .to(phone)
            .message(message)
            .build());
    }

    public void sendFallback(String phone, String message, Exception ex) {
        log.warn("SMS circuit open, queuing retry for {}. Cause: {}", phone, ex.getMessage());
        smsRetryRepository.save(new SmsRetryJob(phone, message));
    }
}
```

Giờ `AppointmentService` chỉ cần gọi `smsService.send(...)` — Circuit Breaker hoạt động đúng qua Spring proxy.

---

## Khi nào nên trip, khi nào không

Không phải lúc nào fail cũng nên tính vào failure rate. HMS gọi external payment gateway — `400 Bad Request` (card hết tiền) không phải lỗi của gateway, không nên trip circuit. Chỉ `5xx` và timeout mới là dấu hiệu service đang có vấn đề:

```yaml
resilience4j:
  circuitbreaker:
    instances:
      paymentGateway:
        record-exceptions:
          - java.io.IOException
          - java.util.concurrent.TimeoutException
        ignore-exceptions:
          - com.hms.exception.PaymentDeclinedException  # 400-level, không trip
```

Nếu bạn `record-exceptions` quá rộng (ví dụ `Exception.class` cho tất cả), circuit sẽ trip vì cả validation error của client — không phải bạn muốn.

---

## Giám sát trạng thái circuit

Resilience4j tích hợp với Spring Boot Actuator:

```yaml
management:
  endpoints:
    web:
      exposure:
        include: health, circuitbreakers
  health:
    circuitbreakers:
      enabled: true
```

`GET /actuator/health` sẽ trả:

```json
{
  "status": "UP",
  "components": {
    "circuitBreakers": {
      "status": "UP",
      "details": {
        "smsService": {
          "status": "CIRCUIT_CLOSED",
          "details": {
            "failureRate": "20.0%",
            "bufferedCalls": 10,
            "failedCalls": 2,
            "state": "CLOSED"
          }
        }
      }
    }
  }
}
```

Khi `state` chuyển sang `OPEN`, alert ngay — không chờ user báo lỗi.

---

## Takeaway

Circuit Breaker không fix service đang chết — nó ngăn service đang chết kéo theo những thứ khác. SMS bị open circuit: booking vẫn chạy, SMS queue lại để retry sau. Không có circuit: một service chậm giữ thread đến khi cạn pool, toàn bộ HMS chờ timeout. Wrap những external call — SMS, payment, third-party API — đừng bao giờ gọi thẳng không có protective layer.

---

*Bài tiếp theo: Service Mesh là gì và khi nào bạn cần nó*
