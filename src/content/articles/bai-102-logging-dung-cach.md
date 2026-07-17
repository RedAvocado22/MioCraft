---
title: "Logging đúng cách — vì sao log của bạn đang vô dụng lúc cần nhất"
description: "Log quá nhiều không giúp debug nhanh hơn. Log đúng level, đúng context, đúng thông tin — và biết những gì tuyệt đối không được log. MDC correlation ID để trace request xuyên suốt."
category: programming
pubDate: 2024-04-20
series: "Phần 2: Clean Code"
tags: ["clean-code", "logging", "debugging", "observability"]
---

---

Production đang có bug. User báo cáo họ book appointment xong nhưng không thấy confirmation. Bạn mở log ra xem — và thấy một đống thế này:

```
INFO  AppointmentService: Processing appointment
INFO  AppointmentService: Appointment saved
INFO  AppointmentService: Done
```

Ba dòng log. Không có ID nào. Không có context nào. Không giúp được gì cả.

Đây không phải vấn đề của log level. Đây là vấn đề của tư duy: **log không phải để bạn biết code đang chạy — log là để bạn debug khi code chạy sai.**

---

## Log tốt trả lời những câu hỏi cụ thể

Khi production có vấn đề, bạn cần trả lời:

- **Ai** đang làm gì? (userId, requestId)
- **Cái gì** đang xảy ra? (operation, entity, ID cụ thể)
- **Kết quả** là gì? (success/failure, thời gian xử lý)
- **Tại sao** nếu có lỗi? (error message, stack trace có nghĩa)

Log tốt không phải log nhiều — là log **đúng thông tin**.

```java
// ❌ Vô dụng — không context, không ID, không thể trace
log.info("Processing appointment");
log.info("Appointment saved");

// ✅ Hữu ích — ai làm gì với cái gì, kết quả ra sao
log.info("Creating appointment: doctorId={}, patientId={}, scheduleId={}, requestId={}",
    command.getDoctorId(), command.getPatientId(), command.getScheduleId(), requestId);
log.info("Appointment created successfully: appointmentId={}, duration={}ms",
    appointment.getId(), System.currentTimeMillis() - startTime);
```

---

## Log level không phải để trang trí

Mỗi level có ý nghĩa cụ thể và bạn phải dùng đúng — vì trong production, bạn thường chỉ enable một số level nhất định:

**ERROR:** Có gì đó sai và cần được alert ngay. Đây là những thứ bạn muốn được wake up lúc 2 giờ sáng để xử lý.
```java
// ✅ Đúng chỗ cho ERROR
log.error("Payment processing failed: appointmentId={}, amount={}, error={}",
    appointmentId, amount, e.getMessage(), e);
```

**WARN:** Có gì đó không bình thường nhưng system vẫn handle được. Đáng để review nhưng không phải emergency.
```java
// ✅ Đúng chỗ cho WARN
log.warn("Appointment slot nearly full: scheduleId={}, remaining={}/{}",
    scheduleId, remaining, maxSlots);
```

**INFO:** Happy path — những sự kiện quan trọng trong business flow khi mọi thứ hoạt động bình thường.
```java
// ✅ Đúng chỗ cho INFO — business event đáng track
log.info("Appointment confirmed: appointmentId={}, doctorId={}, patientId={}",
    appointment.getId(), appointment.getDoctorId(), appointment.getPatientId());
```

**DEBUG:** Chi tiết kỹ thuật chỉ cần lúc troubleshoot — tắt trong production mặc định.
```java
// ✅ Đúng chỗ cho DEBUG
log.debug("Cache lookup: key={}, hit={}", cacheKey, cached != null);
```

Một lỗi phổ biến: dùng `log.info` cho mọi thứ, kể cả lỗi. Lúc cần filter để tìm anomaly thì không thể.

---

## Structured logging — log để machine đọc, không chỉ cho bạn đọc

Log thuần text tốt cho việc đọc thủ công. Nhưng khi bạn có hàng triệu log entries và cần tìm tất cả requests bị lỗi của một user cụ thể trong 1 giờ qua — bạn cần log có structure.

```xml
<!-- logback-spring.xml — output JSON thay vì plain text -->
<dependency>
    <groupId>net.logstash.logback</groupId>
    <artifactId>logstash-logback-encoder</artifactId>
</dependency>
```

```xml
<appender name="JSON_CONSOLE" class="ch.qos.logback.core.ConsoleAppender">
    <encoder class="net.logstash.logback.encoder.LogstashEncoder">
        <includeMdc>true</includeMdc>
    </encoder>
</appender>
```

Output:
```json
{
  "timestamp": "2024-01-15T10:30:00.123Z",
  "level": "INFO",
  "logger": "AppointmentService",
  "message": "Appointment confirmed",
  "appointmentId": "appt-001",
  "doctorId": "doc-123",
  "patientId": "pat-456",
  "requestId": "req-789",
  "userId": "user-001"
}
```

Với structured log, query trong Kibana hay Grafana trở thành: `level:ERROR AND userId:"user-001" AND @timestamp:[now-1h TO now]`. Bạn filter được ngay lập tức thay vì grep qua text.

---

## MDC — context tự động theo mọi log trong request

Thay vì truyền `requestId`, `userId` vào từng log call, dùng MDC (Mapped Diagnostic Context) — nó attach context vào thread hiện tại, mọi log trong request đó tự động có context này:

```java
@Component
public class RequestLoggingFilter extends OncePerRequestFilter {

    @Override
    protected void doFilterInternal(HttpServletRequest request,
                                    HttpServletResponse response,
                                    FilterChain chain) throws ServletException, IOException {
        String requestId = UUID.randomUUID().toString();
        
        // Attach vào thread — mọi log trong request này đều có requestId
        MDC.put("requestId", requestId);
        MDC.put("path", request.getRequestURI());
        
        try {
            chain.doFilter(request, response);
        } finally {
            MDC.clear(); // ❗ Quan trọng — clear sau mỗi request
        }
    }
}
```

Sau đó trong service, bạn không cần truyền requestId vào:

```java
// requestId tự động có trong log nhờ MDC
log.info("Appointment created: appointmentId={}", appointment.getId());
// Output: {"requestId": "req-789", "message": "Appointment created", "appointmentId": "appt-001"}
```

---

## Những thứ không nên log

Logging không chỉ là về "log đủ nhiều". Có những thứ **không được log**:

```java
// ❌ Tuyệt đối không log sensitive data
log.info("User login: username={}, password={}", username, password);
log.info("Payment: cardNumber={}, cvv={}", cardNumber, cvv);
log.info("JWT token: {}", token); // Token = credentials
```

PII (Personally Identifiable Information) như số điện thoại, địa chỉ, thông tin y tế — đặc biệt nhạy cảm trong HMS — không được log ở mức INFO trở lên. Nếu cần debug, dùng ID thay vì raw data.

---

## Takeaway

Log là công cụ chính bạn có khi production đang cháy và bạn không thể attach debugger vào. Viết log với mindset: *"Nếu mình không có bất kỳ context nào khác ngoài file log này, mình có thể tìm ra chuyện gì đã xảy ra không?"* Nếu câu trả lời là không — log đó chưa đủ tốt.

---

*Bài tiếp theo: Integration Test — tại sao unit test xanh hết mà vẫn deploy ra production bị lỗi.*
