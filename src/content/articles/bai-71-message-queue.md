---
title: "Message Queue — khi nào cần, khi nào không"
description: "Queue giải decoupling giữa producer và consumer — nhưng cũng thêm complexity, latency, và failure modes mới. Không phải bài toán nào cũng cần queue."
category: system-design
pubDate: 2024-03-12
series: "Phần 8: System Design"
tags: ["system-design", "message-queue", "async"]
---

Một bệnh nhân vừa đặt lịch khám thành công. Hệ thống cần làm gì tiếp theo?

Gửi email confirmation. Gửi SMS reminder. Notify cho doctor. Update analytics dashboard. Tạo billing record. Có thể còn vài thứ nữa tùy business logic.

Câu hỏi đặt ra: tất cả những việc đó có cần xảy ra *ngay lập tức*, *trong cùng một request*, *đồng bộ* không?

Câu trả lời cho cái bẫy phổ biến nhất mà dev hay rơi vào: *có, tất nhiên, mình cần confirm ngay.*

Câu trả lời đúng: *phụ thuộc vào từng việc.*

---

## Synchronous là gì và nó tốn gì

Khi bạn gọi một method, chờ nó xong, rồi tiếp tục — đó là synchronous. Trong Spring Boot, khi một HTTP request đến, Tomcat assign một thread để xử lý. Thread đó bị chiếm cho đến khi response được trả về. Nếu trong quá trình xử lý bạn gọi thêm external service — email provider, SMS gateway — thread đó ngồi chờ response từ những service đó.

Giả sử gửi email mất 300ms, gửi SMS mất 200ms, update analytics mất 100ms. Bệnh nhân phải chờ tổng cộng 300 + 200 + 100 + business logic = ~700ms chỉ để nhận response "đặt lịch thành công." Tệ hơn, nếu SMS gateway đang có vấn đề và timeout sau 5 giây, toàn bộ request booking bị block 5 giây.

Và nếu SMS gateway throw exception, booking transaction rollback — bệnh nhân đặt lịch thất bại vì một lý do hoàn toàn không liên quan đến booking.

---

## Message Queue giải quyết điều này

Message Queue là một component trung gian. Thay vì gọi trực tiếp đến email service, bạn publish một message vào queue: *"có appointment mới, cần gửi email confirmation."* Queue lưu message đó lại. Một consumer service khác — chạy riêng, độc lập — đọc message từ queue và thực sự gửi email.

```
Booking Request → AppointmentService → [Queue] → EmailConsumer → Send Email
                                     → [Queue] → SMSConsumer → Send SMS
                                     → [Queue] → AnalyticsConsumer → Update Dashboard
```

Booking service không biết email đã được gửi chưa. Nó không quan tâm. Trách nhiệm của nó kết thúc ở việc publish message.

Kết quả: response time của booking request giảm xuống chỉ còn thời gian xử lý business logic + thời gian publish message (thường < 5ms). Email và SMS xảy ra asynchronously.

---

## Decoupling và Durability — hai lợi ích thực sự

**Decoupling:** Booking service không cần biết email service tồn tại. Ngày sau bạn thêm push notification, thêm consumer mới vào queue — booking service không cần thay đổi một dòng nào. Ngược lại, nếu email service down, booking service vẫn hoạt động bình thường — message nằm trong queue, chờ email service recover rồi consume.

**Durability:** Queue tốt (như RabbitMQ hay Kafka) persist message vào disk. Nếu consumer crash giữa chừng sau khi đọc message nhưng chưa xử lý xong, message không bị mất — nó được requeue và xử lý lại. Đây là guarantee mà synchronous call không có: nếu email service crash sau khi bạn gọi nhưng trước khi nó xử lý xong, email đó mất tích vĩnh viễn.

---

## Nhưng Queue không phải silver bullet

Đây là điểm mình cần bạn đọc kỹ. Queue giải quyết một số vấn đề và tạo ra vấn đề khác.

**Eventual consistency là thật.** Khi booking service publish message, email chưa được gửi. Bệnh nhân thấy "đặt lịch thành công" nhưng inbox chưa có gì. Nếu queue consumer lag, có thể vài phút sau email mới đến. User có thể confused, có thể check spam, có thể gọi hotline hỏi. Đây không phải lỗi kỹ thuật — đây là behavior cần được communicate rõ với user.

**Debugging và observability khó hơn.** Khi có bug, trace của một operation giờ span qua nhiều service, nhiều process, nhiều log file. Một message không được xử lý — bạn tìm lỗi ở đâu? Queue? Consumer? Network? Distributed tracing (như Zipkin) trở nên necessary thay vì optional.

**Ordering không được đảm bảo mặc định.** Nếu bạn publish message "appointment created" rồi ngay sau đó "appointment cancelled" (user bấm nhầm), không có gì đảm bảo consumer xử lý theo đúng thứ tự đó. Đây là một class bug tinh vi.

**Infrastructure phức tạp hơn.** Queue cần được deploy, monitor, và maintain. Nó là thêm một điểm failure trong hệ thống.

---

## Khi nào nên dùng Queue

Dùng queue khi operation thỏa mãn ít nhất một trong các điều kiện:

- **Không cần kết quả ngay** — gửi email, gửi notification, update analytics, index search engine
- **Có thể retry được** — nếu operation fail, thử lại sau một lúc là acceptable
- **Tốc độ xử lý không đồng đều** — lúc peak traffic bạn nhận 1000 request/giây nhưng email server chỉ handle được 100/giây. Queue đóng vai trò buffer
- **Cần decoupling thực sự** — booking service không nên bị ảnh hưởng khi notification service có vấn đề

Không dùng queue khi:

- **Cần kết quả để trả về response** — kiểm tra slot còn trống không? Cần trả lời ngay cho user, không thể async
- **Cần strong consistency trong một transaction** — payment và booking cần atomic, không thể split qua queue mà không có Saga pattern (phức tạp hơn nhiều)
- **Operation quá nhẹ** — thêm overhead của queue cho một operation 5ms là over-engineering

---

## Spring Boot và Queue

Trong Spring Boot, `@TransactionalEventListener` là cách đơn giản nhất để implement in-process async event — không cần external queue:

```java
// Booking service publish event sau khi transaction commit
@Service
public class AppointmentService {
    @Autowired
    private ApplicationEventPublisher eventPublisher;
    
    @Transactional
    public AppointmentResponse createAppointment(AppointmentRequest request) {
        Appointment appointment = // ... tạo appointment
        
        // Event chỉ được publish SAU KHI transaction commit thành công
        eventPublisher.publishEvent(new AppointmentCreatedEvent(appointment));
        
        return mapper.toResponse(appointment);
    }
}

// Notification handler nhận event — chạy trong thread khác, không block response
@Component
public class AppointmentNotificationHandler {
    @Async
    @TransactionalEventListener(phase = TransactionPhase.AFTER_COMMIT)
    public void onAppointmentCreated(AppointmentCreatedEvent event) {
        notificationService.sendConfirmation(event.getAppointment());
    }
}
```

Đây là "queue lite" — không có persistence như RabbitMQ, nhưng đủ tốt cho nhiều use case và không cần thêm infrastructure. Nếu sau này cần durability thật sự, swap implementation sang RabbitMQ/Kafka mà không phải thay đổi business code.

---

## Takeaway

Lần tới khi bạn có một operation xảy ra sau một action của user, hỏi: *"Nếu operation này fail hoặc chậm, user có cần biết ngay không?"* Nếu không — đó là candidate cho async. Nhưng nhớ: async không free, nó trade synchronous complexity cho distributed system complexity.

---

*Bài tiếp theo: Rate Limiting — hàng rào bảo vệ API khỏi spam và DDoS*
