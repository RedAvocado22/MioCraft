---
title: "Distributed Tracing — request chết ở đâu trong chuỗi service?"
description: "Trace ID theo request qua nhiều service, Micrometer Tracing với Spring Boot 3, đọc waterfall diagram để debug."
category: programming
pubDate: 2026-07-12
series: "Phần 12: Production & Ops"
tags: ["distributed-tracing", "micrometer", "zipkin", "observability", "spring-boot"]
---

User báo: "Tôi bấm đặt lịch, nó xoay mấy giây rồi báo lỗi." Bạn mở log `AppointmentService` — không thấy exception. Mở log `NotificationService` — không thấy gì liên quan. `PaymentService` — cũng không. Bạn không biết request đó đã đi đến đâu, dừng ở đâu, tốn bao lâu ở từng bước.

Trong monolith, thread ID theo request qua toàn bộ call stack — một log file, một search. Trong microservices, request nhảy qua 4 service, 4 log file riêng, 4 server riêng. Không có gì link chúng lại.

**Distributed tracing** giải quyết chính xác vấn đề này.

---

## Trace ID và Span ID — hai khái niệm cần hiểu

Khi user bấm "Đặt lịch", request tạo ra một **trace** — đại diện cho toàn bộ hành trình từ đầu đến cuối. Trace này có một **trace ID** duy nhất, ví dụ `a3f8c291b47e2105`.

Trong mỗi service, request đó tạo ra một **span** — đơn vị công việc nhỏ hơn. `AppointmentService` tạo một span, gọi `NotificationService` tạo một span con, gọi database tạo một span con nữa. Tất cả span trong cùng một request đều mang cùng trace ID.

```
Trace ID: a3f8c291b47e2105

[AppointmentService]     ├────────────────────────── 450ms ──────────────┤
  [DB query]               ├───── 12ms ──┤
  [gọi NotificationSvc]                    ├──────────── 380ms ──────────┤
    [NotificationService]                   ├──────────── 375ms ─────────┤
      [gọi SMS external]                      ├──────── 360ms ───────────┤
        ← TIMEOUT ở đây
```

Cái diagram này — gọi là **waterfall** — chỉ bạn ngay: 360ms trong 450ms tổng là bị giữ ở SMS external call. Không cần lục log thủ công.

---

## Setup trong Spring Boot 3

Spring Boot 3 dùng **Micrometer Tracing** làm abstraction layer — code instrumentation của bạn không phụ thuộc vào vendor (Zipkin, Jaeger, Tempo). Phần lớn instrumentation là **tự động** cho Spring components.

Dependency (chọn Zipkin làm backend):

```xml
<!-- pom.xml -->
<dependency>
    <groupId>io.micrometer</groupId>
    <artifactId>micrometer-tracing-bridge-brave</artifactId>
    <!-- Brave là implementation của Zipkin -->
</dependency>
<dependency>
    <groupId>io.zipkin.reporter2</groupId>
    <artifactId>zipkin-reporter-brave</artifactId>
</dependency>

<!-- Auto-instrument Spring MVC, WebClient, RestTemplate, JDBC -->
<dependency>
    <groupId>org.springframework.boot</groupId>
    <artifactId>spring-boot-starter-actuator</artifactId>
</dependency>
```

Config `application.yml`:

```yaml
management:
  tracing:
    sampling:
      probability: 1.0  # 100% trong dev; production dùng 0.1 (10%) để giảm overhead

management:
  zipkin:
    tracing:
      endpoint: http://localhost:9411/api/v2/spans  # Zipkin server endpoint

logging:
  pattern:
    # Tự động thêm trace ID vào mỗi log line
    level: "%5p [${spring.application.name:},%X{traceId:-},%X{spanId:-}]"
```

Sau khi config, log của bạn trông như thế này:

```
INFO [appointment-service,a3f8c291b47e2105,9d4a1e8b] - Creating appointment for patient 123
INFO [appointment-service,a3f8c291b47e2105,9d4a1e8b] - Slot validated, persisting...
```

Trace ID `a3f8c291b47e2105` xuất hiện trong log của **mọi service** request đó đi qua — search bằng trace ID là tìm được toàn bộ hành trình.

---

## Trace ID tự động truyền qua HTTP

Khi `AppointmentService` gọi `NotificationService` qua `RestClient` hoặc `WebClient`, Spring tự động inject trace ID vào request header (B3 multi-header format — chuẩn của Brave/Zipkin):

```
GET /notifications/send
X-B3-TraceId: a3f8c291b47e2105
X-B3-SpanId: 9d4a1e8b
X-B3-Sampled: 1
```

`NotificationService` tự động extract header này (nếu cũng cấu hình Micrometer Tracing) và tạo span con với cùng trace ID. Không cần code gì thêm cho HTTP-to-HTTP call.

Nếu bạn dùng `RestTemplate` cũ thay vì `RestClient` (Spring Boot 3.2+), vẫn được auto-instrument. Nếu dùng Feign client, cũng được. Hầu hết HTTP client phổ biến đã có bridge.

---

## Custom span cho business logic quan trọng

Auto-instrumentation cover HTTP, JDBC, Redis. Nhưng đôi khi bạn muốn trace **business operation** cụ thể — ví dụ: validation bệnh nhân mất bao lâu, slot-booking Lua script tốn bao nhiêu:

```java
@Service
@RequiredArgsConstructor
public class AppointmentService {

    private final Tracer tracer;  // io.micrometer.tracing.Tracer

    public AppointmentResponse createAppointment(CreateAppointmentRequest req) {
        // Span tự động từ HTTP layer đã tồn tại
        // Tạo thêm span con để đo slot booking riêng

        Span slotBookingSpan = tracer.nextSpan()
            .name("slot-booking-lua")
            .tag("slotId", req.getSlotId().toString())
            .start();

        try (Tracer.SpanInScope ws = tracer.withSpan(slotBookingSpan)) {
            boolean booked = slotBookingService.tryBook(req.getSlotId(), req.getPatientId());
            if (!booked) {
                throw new SlotAlreadyBookedException(req.getSlotId());
            }
        } catch (Exception ex) {
            slotBookingSpan.error(ex);
            throw ex;
        } finally {
            slotBookingSpan.end();  // Phải end() dù thành công hay fail
        }

        // ... tiếp tục
    }
}
```

Span `slot-booking-lua` sẽ xuất hiện trong waterfall diagram, bạn thấy chính xác nó tốn bao lâu trong tổng thời gian của request.

---

## Đọc waterfall diagram trong Zipkin

Sau khi request xảy ra, vào `http://localhost:9411`, search bằng trace ID hoặc service name, chọn trace:

```
Trace: a3f8c291b47e2105 — Total: 450ms

appointment-service  createAppointment        ════════════════════════ 450ms
appointment-service  SELECT patient            ══ 12ms
appointment-service  slot-booking-lua              ══ 8ms
appointment-service  POST notifications                 ════════════════ 380ms
notification-service sendConfirmation                    ═══════════════ 375ms
notification-service sendSms (external)                    ══════════════ 360ms
                                                                  ↑ TIMEOUT
```

Cái gì bạn học ngay từ diagram này:

- `sendSms` external call chiếm 360ms trong 450ms tổng — bottleneck rõ ràng.
- `slot-booking-lua` chỉ 8ms — không phải vấn đề.
- Database query `SELECT patient` 12ms — acceptable.
- Nếu có Circuit Breaker (bài 139) trip ở đây, bạn thấy error tag trên span `sendSms`.

Không có tracing, bạn chỉ thấy "request mất 450ms" mà không biết 360ms đó ở đâu.

---

## Trace ID trong error response — link từ user đến log

Khi request fail, trả trace ID trong error response:

```java
@ExceptionHandler(Exception.class)
public ResponseEntity<ErrorResponse> handleException(Exception ex, HttpServletRequest request) {
    // Lấy trace ID hiện tại từ MDC (Micrometer đã set sẵn)
    String traceId = MDC.get("traceId");

    log.error("Unhandled exception, traceId={}", traceId, ex);

    return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR)
        .body(ErrorResponse.builder()
            .message("Internal server error")
            .traceId(traceId)  // User thấy, có thể paste khi báo bug
            .timestamp(Instant.now())
            .build());
}
```

User nhận `traceId: "a3f8c291b47e2105"` trong error response. Support team search trace ID đó trong Zipkin — thấy toàn bộ journey của request. Không cần "tái hiện bug" hay hỏi user làm gì.

---

## Sampling — đừng trace 100% ở production

100% sampling nghĩa là gửi mọi request lên Zipkin. Với HMS ở traffic cao, đó là overhead không cần thiết và tốn storage.

Production thường dùng 1–10% sampling. Vẫn đủ để debug — bug thường reproduce ở nhiều trace, không chỉ một. Khi cần debug cụ thể, tăng tạm lên 100% trong vài phút rồi giảm xuống.

```yaml
management:
  tracing:
    sampling:
      probability: 0.05  # 5% ở production
```

Một số setup dùng **adaptive sampling** — rate thấp mặc định, tự động tăng khi detect error spike. Zipkin và Jaeger đều support pattern này nhưng cần config thêm ở collector.

---

## Takeaway

Log cho bạn biết **gì** xảy ra. Trace cho bạn biết **ở đâu và tốn bao lâu**. Trong microservices, không có trace ID truyền qua service, log là những mảnh ghép rời không liên kết được. Setup Micrometer Tracing trong Spring Boot 3 tốn ít hơn 30 phút — nhưng lần đầu debug production incident với trace ID, bạn sẽ không bao giờ muốn làm mà không có nó nữa.

---

*Bài tiếp theo: (tiếp Phần 12 — Production & Ops hoặc Phần 6 — Database)*
