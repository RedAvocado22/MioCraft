---
title: "Blocking vs Non-Blocking — thread đang làm gì khi chờ I/O"
description: "Blocking I/O giữ thread chờ. Non-blocking I/O giải phóng thread để làm việc khác. Hiểu sự khác biệt này giúp bạn thiết kế hệ thống xử lý concurrent requests tốt hơn."
category: system-design
pubDate: 2024-03-02
series: "Phần 7: Backend & Hệ thống"
tags: ["backend", "I/O", "non-blocking", "performance"]
---

Một lỗi hay gặp ở HMS: 

Khi user book appointment, hệ thống phải gọi Keycloak API để lấy thông tin bảo hiểm. Keycloak là external service. Có hôm nó chậm (2-3 seconds). Lúc đó, toàn bộ HMS bị lag — không phải chỉ users đang book, mà cả users đang xem doctor list, đang fetch notifications. Tất cả đều chậm.

Tại sao?

Vì khi thread gọi Keycloak API, thread đó **chặn chờ response**. Và nếu Keycloak chậm, thread chặn lâu. Với 200 threads trong pool, nếu 150 threads đang chặn chờ Keycloak, chỉ còn 50 threads để xử lý requests khác. Toàn bộ hệ thống được lót mỏng. Ngay cả operations nhanh (fetch doctor list) cũng phải chờ threads từ pool.

Đó là **blocking I/O**.

---

## Blocking I/O là gì?

```java
@PostMapping("/appointments/book")
public AppointmentResponse bookAppointment(BookingRequest req) {
    // 1. Thread #47 bắt đầu
    
    InsuranceInfo insurance = keycloakService.getInsurance(req.userId);
    //    ^^^^^^^ Thread #47 gọi API tới Keycloak
    //    Keycloak server 1000km nơi khác, phải:
    //    - Gửi request qua network (10ms)
    //    - Keycloak xử lý (100ms)
    //    - Gửi response về (10ms)
    //    Total: ~120ms
    //    Trong 120ms đó, thread #47 ngồi không. Nó KHÔNG LÀM GÌ CẢ.
    //    Nó chỉ chờ socket read data từ network.
    
    Payment payment = paymentService.processPayment(...);
    // Lại chặn 300ms chờ payment gateway
    
    Appointment app = new Appointment(...);
    return appointment;
    // Thread #47 cuối cùng xong, trả lại pool
}
```

Trong 420ms này, thread #47 **tốn resource nhưng không làm công việc CPU nào**. Nó chỉ chờ. Và OS không thể tái sử dụng thread này để xử lý request khác, vì thread vẫn bận (state = WAITING).

Khi có 100 requests cùng gọi Keycloak, 100 threads trong pool sẽ chặn. Và pool chỉ có 200 threads. Vậy còn lại 100 threads phải xử lý tất cả requests khác của HMS (doctor list, appointment history, etc). Toàn bộ app lag.

---

## Non-Blocking I/O là gì?

```java
// Non-blocking (pseudo-code, không phải Java cơ bản)
@PostMapping("/appointments/book")
public CompletableFuture<AppointmentResponse> bookAppointment(BookingRequest req) {
    // 1. Thread #47 bắt đầu
    
    return keycloakService.getInsuranceAsync(req.userId)
        .thenCompose(insurance -> {
            // 2. Keycloak lấy data xong
            // Nhưng KHÔNG phải thread #47 chờ
            // Khi network packet tới từ Keycloak, callback này được trigger
            // Có thể là thread #47, có thể là thread khác
            
            return paymentService.processPaymentAsync(...);
        })
        .thenApply(payment -> {
            Appointment app = new Appointment(...);
            return app;
        });
    // 3. Thread #47 trả lại pool NGAY LẬP TỨC
    //    Nó không chặn chờ Keycloak hay Payment
    //    Khi results tới, callback được gọi để complete futures
}
```

Khác biệt:

- **Blocking**: Thread chặn chờ Keycloak 120ms. Thread tốn resource trong 120ms đó.
- **Non-blocking**: Thread gửi request rồi trả lại pool ngay. Khi response tới, callback được trigger. Thread khác (hoặc thread pool khác) xử lý callback.

Với non-blocking, cùng 200 threads, cậu có thể handle **hàng chục ngàn concurrent requests** vì threads không chặn.

---

## Spring Boot: Cách nhận biết blocking vs non-blocking

**Blocking:**
```java
// Spring Data JPA — blocking
User user = userRepository.findById(userId).get();
// Thread chặn cho đến khi query xong
```

**Non-blocking:**
```java
// Spring Data R2DBC — non-blocking
Mono<User> user = userRepository.findById(userId);
// Thread không chặn, chỉ setup callback
```

Khác biệt:
- JPA trả về `User` ngay (blocked khi query)
- R2DBC trả về `Mono<User>` (async wrapper, không block)

Nhưng HMS của cậu dùng JPA, nên tất cả database calls đều **blocking**.

---

## Tại sao cậu nên care về blocking?

Vì **mỗi blocking call** trong HMS:

- Database query: 50ms
- Keycloak API: 120ms
- Payment gateway: 300ms
- Notification service: 200ms

Nếu book appointment gọi tất cả 4 cái, mỗi request tốn `50 + 120 + 300 + 200 = 670ms thread time`.

Với 200 threads: `200 / 0.67 = 298 requests/second` là peak.

Nếu 500 users đang dùng app cùng lúc, mỗi user 10 requests/minute, cậu cần `500 * 10 / 60 = 83 req/s`. Vẫn ổn.

**Nhưng** nếu Keycloak chậm hôm nay (1 second thay vì 120ms), book appointment bây giờ tốn `1050ms`. Peak throughput giảm xuống `200 / 1.05 = 190 req/s`. Hệ thống bắt đầu backing up.

Nếu Keycloak chậm còn hơn (2 seconds), peak throughput = `200 / 2.05 = 97 req/s`. Mà cậu cần 83. Borderline.

Nếu có thêm một cascading failure (payment gateway cũng chậm), cậu sẽ out of capacity.

---

## Cách minimize blocking trong Spring Boot

Khi cậu không thể switch sang non-blocking:

**1. Parallel blocking calls** — nếu không có dependency:

```java
// ❌ Sequential
InsuranceInfo insurance = keycloakService.getInsurance(userId);  // 120ms
Payment payment = paymentService.processPayment(...);             // 300ms
// Total: 420ms

// ✅ Parallel
CompletableFuture<InsuranceInfo> insFuture = 
    CompletableFuture.supplyAsync(() -> keycloakService.getInsurance(userId));
CompletableFuture<Payment> payFuture = 
    CompletableFuture.supplyAsync(() -> paymentService.processPayment(...));

InsuranceInfo ins = insFuture.join();
Payment pay = payFuture.join();
// Total: ~300ms (parallelized)
```

**2. Caching** — tránh gọi external service:

```java
@Cacheable("user-insurance")
public InsuranceInfo getInsurance(String userId) {
    return keycloakService.getInsurance(userId);
}
// Lần đầu: 120ms. Lần sau: <1ms (from cache)
```

**3. Circuit Breaker** — nếu external service chậm, fail fast:

```java
@CircuitBreaker(name = "keycloak", fallbackMethod = "getInsuranceFallback")
public InsuranceInfo getInsurance(String userId) {
    return keycloakService.getInsurance(userId);
}

public InsuranceInfo getInsuranceFallback(String userId, Exception e) {
    return new InsuranceInfo(default_values);  // return default, không chặn
}
// Nếu Keycloak đã fail 5 lần liên tiếp, circuit mở
// Requests sau sẽ fallback ngay, không chịu chịu chặn 2+ seconds
```

---

## Practical: Monitoring blocking

Khi HMS slow, kiểm tra thread states:

```bash
jstack <PID> | grep "java.lang.Thread.State: WAITING" | wc -l
```

Nếu số threads WAITING quá cao (>150/200), vấn đề là blocking I/O. Kiểm tra `jstack` output xem threads chặn ở đâu:

```
"http-nio-8080-exec-47" #47
  java.lang.Thread.State: WAITING
    at com.keycloak.client.KeycloakHttpClient.sendRequest(KeycloakHttpClient.java:123)
```

→ Threads chặn ở Keycloak. Kiểm tra Keycloak logs, network latency, hoặc switch sang circuit breaker + cache.

---

## Takeaway

Blocking I/O không phải là evil. Nó là design choice của Spring Boot. Nhưng khi external services chậm, blocking calls có thể drain thread pool ngay lập tức. Khi đó, hệ thống không recover.

Cách phòng chống: **cache, parallel, circuit breaker**. Mỗi cái giải quyết một aspect của blocking problem.

---

*Bài tiếp theo: Caching — vì sao server không query database mỗi lần*
