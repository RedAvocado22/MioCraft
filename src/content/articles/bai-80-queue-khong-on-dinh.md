---
title: "Queue không phải lúc nào cũng làm hệ thống ổn định hơn"
description: "Queue che đi failure thay vì giải quyết nó. Message tích lũy trong queue, consumer xử lý không kịp, queue overflow — hệ thống sập theo cách chậm hơn nhưng vẫn sập."
category: system-design
pubDate: 2024-03-21
series: "Phần 9: Không phải lúc nào cũng đúng"
tags: ["tech-myths", "queue", "resilience"]
---

Queue — Kafka, RabbitMQ, SQS — có một reputation gần như huyền thoại trong giới backend: thêm queue vào là hệ thống trở nên resilient, scalable, decoupled. Một câu trả lời cho mọi vấn đề async.

Thực tế thì queue giải quyết một số vấn đề và tạo ra một số vấn đề khác. Và với nhiều use case, nó là overkill hoàn toàn.

---

## Vấn đề queue thực sự giải quyết

Queue có giá trị thật khi:

**Load leveling** — system nhận 10,000 request trong 1 giây nhưng chỉ process được 1,000/giây. Queue cho phép absorb spike và process dần, thay vì drop request hoặc crash.

**Decoupling availability** — producer không cần consumer online cùng lúc. `AppointmentService` có thể send notification event vào queue và tiếp tục, kể cả khi `NotificationService` đang restart.

**Long-running job** — export báo cáo hàng nghìn record, gửi email hàng loạt, generate file PDF — những thứ không nên block HTTP request.

Ba use case đó là thật. Nhưng không phải mọi async operation đều thuộc ba trường hợp này.

---

## Khi queue trở thành nguồn gốc của complexity

Trong HMS, `NotificationService` cần gửi reminder cho bệnh nhân 1 ngày trước lịch hẹn. Một dev có thể nghĩ: "cần queue để handle này."

Nhưng hãy nhìn xem: reminder scheduling là một **cron job**, không phải event-driven operation. Không có spike load, không có decoupling requirement, không có long-running compute. Một `@Scheduled` annotation trong Spring là đủ:

```java
// ✅ Đủ rồi — không cần queue
@Scheduled(cron = "0 8 * * *") // Chạy lúc 8 giờ sáng mỗi ngày
@Transactional(readOnly = true)
public void sendAppointmentReminders() {
    LocalDate tomorrow = LocalDate.now().plusDays(1);
    
    List<Appointment> upcomingAppointments = appointmentRepository
        .findConfirmedAppointmentsByDate(tomorrow);
    
    upcomingAppointments.forEach(appointment -> {
        notificationService.sendReminder(appointment);
    });
}
```

Thêm Kafka vào đây không làm nó ổn định hơn. Nó thêm vào: một Kafka broker cần operate, consumer group configuration, offset management, dead letter queue cho message fail, monitoring lag, và một class of bug hoàn toàn mới (message ordering, at-least-once vs exactly-once delivery).

---

## Queue không make things reliable — nó shift responsibility

Đây là điều ít người hiểu rõ: queue không làm operation reliable hơn, nó **defer** failure và làm failure visible ở một chỗ khác.

Nếu `NotificationService` down, không có queue hay có queue thì notification vẫn không được gửi. Với queue, notification nằm trong queue và eventually được gửi khi service recover — đó là điểm tốt. Nhưng bạn cũng phải xử lý: message expire trong queue, consumer fail sau khi consume nhưng trước khi process xong (at-least-once → idempotency requirement), poison message làm consumer crash loop.

Spring's `@TransactionalEventListener` mà HMS đang dùng cho notification sau booking là một ví dụ của "just enough async" — event được publish sau khi transaction commit, xử lý trong cùng process, không cần external broker. Nếu fail thì fail rõ ràng và có thể retry với mechanism đơn giản hơn.

Upgrade lên Kafka chỉ có nghĩa khi `NotificationService` cần tách ra thành một separate service với separate deployment — tức là khi bạn đang đi theo hướng microservices với lý do rõ ràng.

---

## Heuristic để quyết định

Trước khi thêm queue, hỏi ba câu:

**Operation này có thể blocking không?** Nếu gửi notification mất 200ms và user có thể chờ được — không cần queue.

**Producer và consumer có cần độc lập về availability không?** Nếu cả hai chạy trong cùng process, queue là overhead vô nghĩa.

**Có spike load thật sự không?** Nếu traffic tương đối stable, load leveling không phải vấn đề.

Nếu ba câu đều là "không" — `@Async` hoặc `@TransactionalEventListener` là đủ. Nếu ít nhất một câu là "có" thì mới bắt đầu nghĩ đến queue.

---

## Takeaway

Queue là infrastructure, và infrastructure có cost. Cái cost đó justified khi problem cần giải quyết đủ lớn. Khi chưa đến ngưỡng đó, đừng để complexity của solution vượt quá complexity của problem.

---

*Bài tiếp theo: Scaling sớm không phải lúc nào cũng là quyết định đúng*
