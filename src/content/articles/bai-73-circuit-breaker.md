---
title: "Circuit Breaker — vì sao một service chết mà cả hệ thống không sập theo"
description: "Khi service B chậm, service A gọi B sẽ bị block, thread pool cạn kiệt, và A sập theo. Circuit Breaker phát hiện failure và ngắt connection trước khi cascade xảy ra."
category: system-design
pubDate: 2024-03-14
series: "Phần 8: System Design"
tags: ["system-design", "circuit-breaker", "resilience"]
---

Có một kiểu sự cố đặc biệt nguy hiểm trong distributed system: không phải service chết hoàn toàn, mà service chết chậm.

Hãy tưởng tượng notification service của HMS đang bị overload. Nó không từ chối connection — nó vẫn accept request, nhưng xử lý rất chậm, timeout sau 30 giây. Booking service gọi đến notification service để gửi confirmation email. Mỗi request giờ mất 30 giây. Thread của Tomcat bị hold trong 30 giây đó. Dần dần, toàn bộ thread pool của booking service bị chiếm bởi những request đang chờ notification service. Booking service không còn thread để xử lý request mới. Booking service sập.

Một service đang gặp vấn đề, hai service sập. Hiệu ứng này gọi là **cascading failure**.

---

## Tại sao cascading failure xảy ra

Trong một hệ thống mà các service gọi nhau, khi một service chậm, tất cả service gọi đến nó đều bị block. Nếu chúng cũng bị block đủ lâu, chúng cũng sập. Và các service gọi đến những service đó cũng sẽ sập theo.

Vấn đề ở đây là: **tài nguyên (threads, connections) là finite**. Khi mày không có cơ chế để "dừng lại" khi phát hiện downstream service đang có vấn đề, mày tiếp tục dùng tài nguyên để gọi những request biết trước là sẽ fail — cho đến khi không còn tài nguyên nữa.

---

## Circuit Breaker — giải pháp vay từ kỹ thuật điện

Cái tên "circuit breaker" đến từ công tắc điện trong nhà mày. Khi có chập điện, thay vì để toàn bộ hệ thống bị thiêu rụi, công tắc tự ngắt — ngăn dòng điện tiếp tục chạy. Sau khi vấn đề được khắc phục, mày bật lại.

Circuit breaker trong software hoạt động theo nguyên lý tương tự, với ba trạng thái:

**CLOSED — bình thường.** Request được forward đến service bình thường. Circuit breaker theo dõi tỷ lệ failure. Nếu tỷ lệ failure vượt quá threshold (ví dụ: 50% trong 10 giây qua), nó chuyển sang OPEN.

**OPEN — đang bị ngắt.** Circuit breaker *không gọi* đến service nữa. Thay vào đó, nó fail fast ngay lập tức — trả về lỗi hoặc fallback response mà không tốn time chờ. Thread không bị block. Sau một khoảng thời gian (ví dụ: 30 giây), nó chuyển sang HALF-OPEN để thử lại.

**HALF-OPEN — đang thăm dò.** Cho phép một số lượng nhỏ request đi qua. Nếu những request đó thành công, circuit chuyển về CLOSED — service đã recover. Nếu vẫn fail, quay lại OPEN.

---

## Resilience4j trong Spring Boot

Resilience4j là library standard cho circuit breaker trong Spring Boot ecosystem. Với Spring Boot 3, nó integrate rất clean:

```java
// Dependency: spring-cloud-starter-circuitbreaker-resilience4j

// application.yml
resilience4j:
  circuitbreaker:
    instances:
      notificationService:
        # Chuyển sang OPEN khi 50% request fail trong sliding window 10 giây
        failure-rate-threshold: 50
        # Cần ít nhất 5 request mới bắt đầu tính
        minimum-number-of-calls: 5
        # Giữ OPEN trong 30 giây rồi thử HALF-OPEN
        wait-duration-in-open-state: 30s
        # HALF-OPEN: cho 3 request đi qua để test
        permitted-number-of-calls-in-half-open-state: 3
        # Slow call cũng tính là failure nếu > 3 giây
        slow-call-duration-threshold: 3s
        slow-call-rate-threshold: 100
```

```java
@Service
public class AppointmentService {
    
    @Autowired
    private NotificationClient notificationClient;
    
    @Transactional
    public AppointmentResponse createAppointment(AppointmentRequest request) {
        Appointment appointment = saveAppointment(request);
        
        // Circuit breaker bao quanh call đến notification service
        sendConfirmationNotification(appointment);
        
        return mapper.toResponse(appointment);
    }
    
    @CircuitBreaker(name = "notificationService", fallbackMethod = "notificationFallback")
    private void sendConfirmationNotification(Appointment appointment) {
        notificationClient.sendConfirmation(appointment.getId());
    }
    
    // Fallback: khi circuit OPEN hoặc call fail, chạy cái này thay thế
    private void notificationFallback(Appointment appointment, Exception ex) {
        // Log để retry sau, hoặc lưu vào queue để xử lý khi service recover
        log.warn("Notification service unavailable for appointment {}, will retry later", 
                  appointment.getId());
        pendingNotificationRepository.save(new PendingNotification(appointment.getId()));
    }
}
```

Điều quan trọng: **booking vẫn thành công** dù notification service đang down. Appointment được tạo ra, transaction commit. Notification được lưu vào `pending_notifications` table để retry sau. User không bị ảnh hưởng bởi vấn đề của một service không liên quan đến core flow.

---

## Fallback strategy — không phải mọi thứ đều có thể fallback

Khi circuit open, mày có một số lựa chọn cho fallback:

**Return cached data:** Nếu notification service cũng cung cấp data (không chỉ side effect), trả về cached version từ Redis. User thấy data hơi cũ nhưng vẫn thấy gì đó.

**Degrade gracefully:** Booking thành công, email sẽ đến sau. Thông báo cho user: "Xác nhận booking đã được gửi, email confirmation sẽ đến trong vài phút." Đây là honest degradation.

**Queue for later:** Như ví dụ trên — lưu pending notification vào database, một background job sẽ retry khi service recover.

**Hard fail:** Đôi khi không có fallback hợp lý — nếu payment service down, mày không thể fallback việc charge tiền. Fail fast và trả về lỗi cho user là correct behavior.

Cái gì là fallback phù hợp phụ thuộc vào business logic, không phải technical preference.

---

## Timeout — người anh em của Circuit Breaker

Circuit breaker và timeout làm việc cùng nhau. Timeout đảm bảo một request không chờ vô hạn — nếu service không response trong 3 giây, cắt connection và coi đó là failure. Circuit breaker theo dõi những failure đó và quyết định khi nào nên ngừng gọi hoàn toàn.

Không có timeout thì circuit breaker hoạt động kém hiệu quả — nó sẽ phải chờ đến khi request timeout thực sự xảy ra trước khi record failure, và trong thời gian đó thread vẫn bị block.

```java
# Timeout config cho Feign client (nếu dùng microservices)
# Hoặc RestTemplate/WebClient cho HTTP call
resilience4j:
  timelimiter:
    instances:
      notificationService:
        timeout-duration: 3s
```

---

## Circuit Breaker ở HMS của mày

Trong HMS monolith, circuit breaker relevant nhất khi mày có external service calls — Keycloak, email provider, SMS gateway. Internal method calls trong cùng process không cần circuit breaker vì chúng không có network failure.

Nếu sau này tách ra microservices, circuit breaker trở thành mandatory cho mọi service-to-service call.

---

## Takeaway

Circuit breaker không ngăn service fail — nó ngăn failure lan rộng ra. Thiết kế hệ thống với assumption rằng bất kỳ external call nào cũng có thể fail, và mày đã có sẵn câu trả lời cho câu hỏi: *"Khi X fail, hệ thống của tao làm gì?"*

---

*Bài tiếp theo: CAP Theorem — ba thứ không thể có cùng lúc*
