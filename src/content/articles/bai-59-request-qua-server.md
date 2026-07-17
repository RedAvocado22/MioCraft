---
title: "Request đi qua server như thế nào — từ TCP đến response"
description: "Từ lúc bạn gõ Enter đến khi nhận được response — hàng chục bước xảy ra. Hiểu luồng này giúp bạn debug performance issue và thiết kế hệ thống tốt hơn."
category: system-design
pubDate: 2024-02-28
series: "Phần 7: Backend & Hệ thống"
tags: ["backend", "networking", "HTTP", "TCP"]
---

Lúc 14:30 chiều, một user mở app HMS và bấm nút "Book Appointment". Cây API `/appointments/book` được gọi. Bạn có biết chính xác cái gì xảy ra từ lúc request rời khỏi điện thoại user đến lúc response trả về không?

Hầu hết người mới không biết — và đó là lý do khi hệ thống chậm, họ lúng túng. Không hiểu request flow, bạn không biết debug từ đâu.

---

## Request flow có 5 layer — từ hardware đến code

Khi user bấm button, request không bay thẳng vào hàm `bookAppointment()` của bạn. Nó phải đi qua một chuỗi các layer, và ở mỗi layer, có thứ gì đó có thể chậm hoặc sai.

Dưới đây là chuỗi từ điện thoại user → Spring Boot handler → database → response trả lại:

```
User's phone (client)
    ↓ [TCP handshake - 3 way handshake]
    ↓ [TLS handshake - nếu HTTPS, +2 round trip]
Internet / Router
    ↓ [Packet routing - mất thời gian trên network]
    ↓ [Firewall / Load Balancer]
Server (OS level)
    ↓ [OS nhận packet, xếp vào receive buffer]
    ↓ [Application layer - Tomcat (servlet container)]
    ↓ [Thread pool - OS assign thread xử lý request này]
Spring Boot
    ↓ [Dispatcher Servlet - nhận request]
    ↓ [Filter chain - authentication, CORS, etc]
    ↓ [Controller - routing tới endpoint đúng]
    ↓ [Service/Repository - business logic + DB query]
Database
    ↓ [SQL execute, lock, return result]
Spring Boot
    ↓ [Response object serialize to JSON]
    ↓ [Response object write to output buffer]
OS/Tomcat
    ↓ [Flush buffer to network]
Internet
    ↓ [Packet routing back to client]
User's phone
    ↓ [Client receive, parse JSON, render UI]
```

Mỗi layer trên đều có thể chậm. Nhưng người mới thường chỉ nhìn vào layer Spring Boot và nghĩ "code của tôi chậm", trong khi vấn đề có thể nằm ở layer database hoặc network.

---

## Cụ thể: request `/appointments/book` của HMS trở nên chậm

Giả sử bạn nhận feedback: "Khi user book appointment, nó chậm lắm, chờ tới 5 giây".

Bạn bắt đầu:

1. **Nghi ngờ code Spring Boot** — thêm log, kiểm tra hàm `bookAppointment()`. Hàm chạy xong trong 100ms. Vậy sao endpoint chậm?

2. **Nghi ngờ database** — kiểm tra query. Query chạy 50ms. Vậy 5 giây còn lại đó?

3. **Nghi ngờ network** — hỏi devops. Latency từ client tới server là 100ms. Vậy còn ~4.7 giây nữa.

4. **Nghi ngờ concurrency** — 50 user đang book cùng lúc, request của user này bị xếp hàng. Phải chờ request trước nó xong rồi mới chạy.

Nếu bạn không hiểu layer nào của request flow có thể là bottleneck, bạn sẽ debug mù quáng. Đó là tại sao hiểu request flow từ TCP đến response là quan trọng.

---

## Mỗi request cần một thread — và pool có giới hạn

Đây là chi tiết quan trọng nhất.

Khi Spring Boot nhận request, nó gán **một thread từ thread pool** để xử lý request. Thread này sẽ:

- Chạy filter chain
- Chạy controller method
- Chạy service/repository
- Chạy database query
- Serialize response
- Flush response về client
- **Rồi trả lại vào thread pool**

Tomcat (servlet container mặc định của Spring Boot) có thread pool với **default size là 200 threads**.

Nếu 201 requests đến cùng lúc, request thứ 201 phải **chờ trong queue** cho đến khi một trong 200 threads trước nó xong việc.

Và đây là cái bẫy:

```java
@PostMapping("/appointments/book")
public AppointmentResponse bookAppointment(@RequestBody BookingRequest req) {
    // 1. Spring gán thread #47 để xử lý request này
    
    List<DoctorSchedule> slots = scheduleService.getAvailableSlots(...); 
    // 2. Thread #47 gọi database query
    // 3. Thread #47 CHẶN - nó ngồi chờ database trả kết quả
    // 4. Trong thời gian chờ (50ms), thread #47 không làm gì cả, chỉ chờ
    
    Payment payment = paymentService.processPayment(...);
    // 5. Thread #47 gọi Keycloak API
    // 6. Thread #47 lại CHẶN - chờ Keycloak trả response (500ms)
    // 7. Trong thời gian chờ, thread #47 ngồi không
    
    return appointmentRepository.save(appointment);
    // 8. Thread #47 cuối cùng xong, trả lại vào pool
}
```

Nếu database query mất 50ms và Keycloak API mất 500ms, một request tốn **tổng cộng 550ms thread time**.

Với 200 threads và mỗi request tốn 550ms, hệ thống chỉ có thể xử lý được: `200 threads / 0.55 seconds = 363 requests per second`.

Nhưng nếu database chậm lên (1 second per query), hoặc Keycloak API chậm lên (2 seconds), requests bắt đầu xếp hàng. Và khi queue đầy, user mới sẽ bị reject.

---

## Cách debug: Thread dump khi hệ thống chậm

Khi HMS đang chậm, cách debug đúng là **dump threads ra xem chúng đang chờ cái gì**:

```bash
# Lấy PID của process Spring Boot
jps -l

# Dump threads
jstack <PID> > threads.dump

# Hoặc dùng VisualVM để monitor realtime
```

Trong thread dump, bạn sẽ thấy:

```
"http-nio-8080-exec-47" #47 daemon prio=5 os_prio=0
  java.lang.Thread.State: WAITING (parking)
    at sun.misc.Unsafe.park(Native Method)
    at java.util.concurrent.locks.LockSupport.parkNanos(LockSupport.java:215)
    at com.mysql.cj.protocol.NetworkProtocol.read(NetworkProtocol.java:523)
```

Dòng `at com.mysql.cj.protocol.NetworkProtocol.read` nói cho bạn biết: **thread #47 đang chờ MySQL trả kết quả**.

Nếu bạn thấy 150 threads trong 200 đều chờ MySQL, vấn đề không phải ở code Spring Boot — vấn đề ở **database quá chậm hoặc quá tải**.

---

## Takeaway

Lần tới khi hệ thống chậm, đừng nhảy vào code ngay. Hãy hỏi: **ở layer nào của request flow vấn đề nằm?** Network? Database? Thread pool exhaustion? 

Mỗi layer có debug method khác nhau. Hiểu request flow giúp bạn debug đúng chỗ, thay vì đi lòng vòng.

---

*Bài tiếp theo: Thread per Request vs Event Loop — tại sao Spring Boot chọn cái đó*
