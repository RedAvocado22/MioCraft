---
title: "Observer — tại sao notification không được gọi trong transaction"
description: "Observer Pattern giải coupling giữa event publisher và subscriber. Nhưng gọi notification bên trong database transaction là một trong những lỗi kiến trúc phổ biến nhất."
category: programming
pubDate: 2024-02-12
series: "Phần 5: Design Patterns"
tags: ["design-patterns", "observer", "events"]
---

Đây là một bug mà rất nhiều developer viết ra mà không biết — cho đến khi production báo lỗi.

Một appointment được confirm. Notification gửi đi thành công. Nhưng ngay sau đó, database rollback vì một lý do nào đó ở bước sau. Kết quả: user nhận được SMS thông báo lịch khám đã xác nhận, nhưng mở app lên thì appointment vẫn đang ở trạng thái PENDING. Dữ liệu không đồng bộ — và không có cách nào thu hồi cái SMS đó.

Đây không phải bug của notification service. Đây là bug của kiến trúc — cụ thể là đặt side effect ở sai vị trí so với transaction boundary.

---

## Observer pattern là gì

Observer là pattern cho phép một object (subject) thông báo đến nhiều object khác (observers) khi có sự kiện xảy ra — mà không cần biết những observer đó là ai.

Trong Spring, Observer thường được implement qua ApplicationEvent: service publish event, một hoặc nhiều `@EventListener` khác lắng nghe và xử lý. Đây là cách Spring khuyến khích để decouple các module.

```java
// Event class
public record AppointmentConfirmedEvent(UUID appointmentId, UUID patientId, LocalDateTime scheduledAt) {}

// Service publish event
@Service
public class AppointmentService {
    
    @Transactional
    public void confirmAppointment(UUID appointmentId) {
        Appointment appointment = appointmentRepository.findById(appointmentId)
            .orElseThrow(() -> new AppointmentNotFoundException(appointmentId));
        
        appointment.confirm();
        appointmentRepository.save(appointment);
        
        // Publish event — ai quan tâm thì tự xử lý
        eventPublisher.publishEvent(new AppointmentConfirmedEvent(
            appointment.getId(),
            appointment.getPatientId(),
            appointment.getScheduledAt()
        ));
    }
}
```

Trông đúng. Nhưng bug nằm ở đây nếu listener được viết như này:

```java
// ❌ Vấn đề: @EventListener mặc định chạy TRONG transaction của caller
@Component
public class AppointmentNotificationListener {
    
    @EventListener  // ← Đây là vấn đề
    public void onAppointmentConfirmed(AppointmentConfirmedEvent event) {
        notificationService.sendConfirmationSms(event.patientId(), event.scheduledAt());
    }
}
```

Với `@EventListener` thuần, handler này chạy **trong cùng transaction** với `confirmAppointment()`. Nghĩa là nếu transaction roll back sau khi event được publish — SMS đã gửi rồi, không thu hồi được.

---

## `@TransactionalEventListener` — đúng tool cho đúng việc

Spring cung cấp `@TransactionalEventListener` để giải quyết chính xác vấn đề này. Nó cho phép mày chỉ định handler chạy ở **phase nào của transaction lifecycle**.

```java
// ✅ Tốt hơn: chỉ gửi notification sau khi transaction commit thành công
@Component
public class AppointmentNotificationListener {
    
    @TransactionalEventListener(phase = TransactionPhase.AFTER_COMMIT)
    public void onAppointmentConfirmed(AppointmentConfirmedEvent event) {
        // Chỉ chạy khi transaction đã commit — dữ liệu đã được lưu chắc chắn
        notificationService.sendConfirmationSms(event.patientId(), event.scheduledAt());
    }
}
```

`AFTER_COMMIT` đảm bảo: nếu transaction rollback, handler không bao giờ chạy. Không có SMS gửi đi khi dữ liệu chưa được persist.

Các phase khác mà mày cần biết:

- `BEFORE_COMMIT` — chạy trước khi commit, vẫn trong transaction, có thể throw để rollback
- `AFTER_COMMIT` — chạy sau commit thành công, không thể rollback nữa
- `AFTER_ROLLBACK` — chạy khi transaction rollback, dùng để cleanup hoặc compensate
- `AFTER_COMPLETION` — chạy dù commit hay rollback (tương đương finally)

---

## Một gotcha quan trọng

`@TransactionalEventListener` với `AFTER_COMMIT` chạy **sau khi transaction đã đóng**. Nếu handler của mày cần làm gì đó với database — ví dụ lưu notification log — nó sẽ cần một transaction mới.

```java
@TransactionalEventListener(phase = TransactionPhase.AFTER_COMMIT)
@Transactional(propagation = Propagation.REQUIRES_NEW)  // ← Bắt buộc nếu cần DB access
public void onAppointmentConfirmed(AppointmentConfirmedEvent event) {
    notificationService.sendConfirmationSms(event.patientId(), event.scheduledAt());
    
    // Lưu notification log — cần transaction mới vì transaction cũ đã đóng
    notificationLogRepository.save(NotificationLog.of(event));
}
```

Nếu mày quên `REQUIRES_NEW`, Spring sẽ không có transaction active để mày dùng, và JPA sẽ throw exception.

---

## Khi nào dùng Observer qua event, khi nào gọi thẳng

Gọi thẳng (direct call) rõ ràng hơn, dễ trace hơn, dễ test hơn. Đừng dùng event chỉ để trông "kiến trúc hơn."

Dùng event khi:
- Nhiều module cần react với cùng một sự kiện
- Caller không nên phụ thuộc vào các downstream consumer
- Side effect cần được tách khỏi transaction boundary chính

Gọi thẳng khi:
- Chỉ có một consumer
- Consumer là một phần không thể thiếu của cùng transaction
- Cần trace flow rõ ràng và dễ debug

---

## Takeaway

Kiểm tra lại tất cả `@EventListener` trong HMS — cái nào đang gửi notification hoặc làm side effect không thể rollback cần được đổi thành `@TransactionalEventListener(phase = AFTER_COMMIT)`. Đây là một trong những class of bug thầm lặng nhất trong Spring application.

---

*Bài tiếp theo: Facade — tại sao KeycloakService tồn tại thay vì gọi thẳng*
