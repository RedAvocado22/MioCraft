---
title: "Thread per Request vs Event Loop — Spring Boot đang chọn gì và tại sao"
description: "Thread-per-request model của Spring Boot truyền thống vs non-blocking Event Loop của Spring WebFlux. Trade-off về complexity, performance, và khi nào nên dùng cái nào."
category: system-design
pubDate: 2024-03-01
series: "Phần 7: Backend & Hệ thống"
tags: ["backend", "threading", "concurrency", "spring-boot"]
---

Trên Node.js, một request không cần một thread riêng. Mọi request chia sẻ một **event loop duy nhất**, nó xử lý nhiều requests đồng thời mà không chặn.

Trên Spring Boot, mỗi request cần một **thread từ pool**, và thread chặn chờ I/O.

Tại sao hai model khác nhau? Tại sao Spring Boot không chọn event loop như Node.js? Và quan trọng hơn — khi nào bạn sẽ muốn switch sang model async?

---

## Model 1: Thread per Request (Spring Boot default)

Spring Boot dùng **Tomcat** làm servlet container, và Tomcat dùng **thread pool**. Mỗi request → một thread.

```
Request 1: [=============== 500ms ===============]   (thread #1)
Request 2:                    [============ 300ms ============]   (thread #2)
Request 3:                              [=== 100ms ===]   (thread #3)
```

**Tại sao Spring Boot chọn model này:**

1. **Code là synchronous, đơn giản để viết** — hàm `bookAppointment()` chỉ cần viết từ trên xuống dưới. Không cần callback, không cần Promise, không cần async/await.

2. **Request isolation tự nhiên** — mỗi thread có stack riêng, state riêng. Không lo data từ request A lẫn vào request B. Spring Security, transactional context, user context — tất cả đều thread-local.

3. **JVM có built-in scheduler** — OS quản lý threads. Nếu một thread chặn (chờ I/O), OS tự động schedule thread khác chạy. JVM không cần viết event loop.

4. **Mature, stable** — 20 năm các công ty chạy Spring Boot trên model này. Mọi tool, library, pattern đều tối ưu cho synchronous model.

**Nhưng cái giá:**

- Mỗi thread tốn ~1MB memory (JVM threads). 10,000 threads = 10GB RAM chỉ để hold threads.
- Context switching — 200 threads trên 4 CPU core = overhead lớn.
- Nếu thread chặn vì I/O, thread đó vẫn tốn resource, không tính được.

---

## Model 2: Event Loop (Node.js, Netty, Project Reactor)

Node.js dùng **single-threaded event loop**. Một thread duy nhất xử lý tất cả requests. Nhưng nó **không chặn**:

```javascript
// Node.js — non-blocking
app.post('/appointments/book', async (req, res) => {
    // Không tạo thread mới
    // Lúc hàm này đang chờ DB, thread chính có thể xử lý request khác
    
    const slots = await getAvailableSlots(...);  // 50ms, nhưng không chặn
    const payment = await processPayment(...);   // 500ms, nhưng không chặn
    const appointment = await save(...);
    res.json(appointment);
});
```

Phía dưới, Node.js dùng **libuv** (C library) để:
- Gửi query đến database
- **Bỏ qua** (không chặn thread)
- Xử lý request khác
- Khi database trả kết quả, callback được gọi
- Tiếp tục xử lý request cũ

Với event loop, một instance Node.js có thể xử lý **hàng chục ngàn concurrent connections** với **single thread**.

**Tại sao Node.js chọn event loop:**

1. **Memory efficient** — không tạo threads, chỉ cần event loop và callbacks.
2. **Mở rộng được** — một máy nhỏ xử lý hàng ngàn connections.
3. **Avoid context switching** — một thread duy nhất, OS không cần schedule.

**Nhưng cái giá:**

- **Code là asynchronous** — callback hell, promise chain, async/await. Khó để viết, dễ sai.
- **No request isolation** — nếu code không cẩn thận, request A có thể modify global state và ảnh hưởng request B.
- **Blocking code sẽ kill hệ thống** — nếu một operation chặn (ví dụ: synchronous CPU work), **toàn bộ event loop chặn**, tất cả requests bị delay.

---

## Spring Boot + Reactive: Hybrid approach

**Spring Framework 5** (Spring Boot 2.x trở lên) giới thiệu **Spring WebFlux**, cho phép viết code non-blocking như Node.js:

```java
@PostMapping("/appointments/book")
public Mono<AppointmentResponse> bookAppointment(BookingRequest req) {
    return scheduleService.getAvailableSlots(...)         // non-blocking DB query
        .flatMap(slots -> paymentService.processPayment(...))  // chaining
        .flatMap(payment -> appointmentRepository.save(...))
        .map(appointment -> new AppointmentResponse(appointment));
}
```

Spring WebFlux dùng **Netty** (non-blocking framework) thay vì Tomcat. Thread pool nhỏ hơn (core count * 2), requests chia sẻ threads, không chặn.

**Tại sao HMS của bạn không dùng WebFlux:**

1. Bạn đã quen Spring Data JPA + Tomcat. Switching sang WebFlux = rewrite cơ bản.
2. JPA (Hibernate) là **blocking**. Để dùng WebFlux đúng cách, bạn cần R2DBC (reactive database driver). Database config khác, query khác, behavior khác.
3. Bạn đang làm sinh viên, deadline dí. Đừng add complexity không cần thiết.

---

## Khi nào bạn sẽ cần event loop / reactive?

Đó là khi **thread pool exhaustion** xảy ra ở production.

Ví dụ:
- HMS có 500 concurrent users
- Mỗi request tốn 1 second (1 second database query)
- Tomcat thread pool = 200 threads
- Tất cả 200 threads đều chặn chờ database
- Request thứ 201+ phải đợi
- Response time bắt đầu vượt quá 10 seconds
- User bị timeout

Lúc đó, hai lựa chọn:

**A) Tối ưu database** — query nhanh hơn, thread không chặn lâu. Best solution.

**B) Tăng thread pool** — đủ threads cho tất cả users. Nhưng overhead tăng, context switching tăng. Có limit.

**C) Switch sang reactive** — event loop, ít threads, scales better. Nhưng rewrite code, rewrite tests, training.

Bạn nên thử A và B trước. Chỉ khi nào bạn **chứng minh được** A + B không đủ, mới xem xét C.

---

## Practical: Có thể detect bottleneck bằng thread dump

```bash
# Khi hệ thống chậm
jstack <PID> | grep "java.lang.Thread.State" | sort | uniq -c
```

Nếu thấy:
- 180+ threads ở state `WAITING` (chặn I/O) → thread pool nearly exhausted
- Tất cả threads ở state `RUNNABLE` → CPU-bound, không phải I/O

Nếu vấn đề là thread exhaustion, bạn có thể:
1. Tối ưu database (tạo index, tối ưu query)
2. Tăng thread pool (không quá lâu)
3. Dùng async pattern — ví dụ, không chặn user chờ payment completion, dùng callback/webhook thay thế

---

## Takeaway

Spring Boot chọn **thread per request** vì **code đơn giản và isolation tốt**, không phải vì nó optimal ở mọi scenario. Khi bạn hit thread pool limit ở production, bạn có ba lựa chọn: optimize IO, scale horizontally, hoặc switch sang reactive.

Biết limitation của model mà bạn đang dùng là lần đầu để recognize khi nào bạn cần đổi.

---

*Bài tiếp theo: Blocking vs Non-Blocking — root cause của 80% perf issues*
