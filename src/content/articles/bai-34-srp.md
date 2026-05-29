---
title: "SRP — một class ôm quá nhiều là mầm mống thảm họa"
description: "Single Responsibility không có nghĩa là class chỉ có một method. Có nghĩa là class chỉ thay đổi vì một lý do — một actor duy nhất yêu cầu nó thay đổi."
category: programming
pubDate: 2024-02-03
series: "Phần 4: SOLID"
tags: ["SOLID", "SRP", "OOP"]
---

Có một câu hỏi mà senior hay hỏi junior khi review code: *"Class này tồn tại để làm gì?"*

Câu hỏi đó nghe đơn giản. Nhưng hầu hết junior không trả lời được trong một câu. Họ sẽ nói: *"Ờ, nó xử lý appointment — validate input, lưu database, gửi notification, ghi log..."* Đó là dấu hiệu đầu tiên của vấn đề.

**Single Responsibility Principle** nói rằng một class chỉ nên có một lý do để thay đổi. Một. Không phải hai, không phải năm.

---

## "Một lý do để thay đổi" nghĩa là gì

Đây là chỗ nhiều người hiểu sai SRP. Họ nghĩ "một responsibility" nghĩa là class chỉ được làm đúng một việc theo nghĩa đen — một method, một function, xong.

Không phải vậy. Uncle Bob định nghĩa nó theo chiều khác: *một class chỉ nên có một "chủ" — một actor, một stakeholder có quyền yêu cầu nó thay đổi.*

Lấy ví dụ cụ thể từ HMS. Trong một `AppointmentService` lớn, mày đang phục vụ nhiều "chủ" khác nhau:

- **Business team** muốn thay đổi logic booking — chỉ cho phép book trước 24h
- **Ops team** muốn thay đổi format audit log — thêm IP address
- **Notification team** muốn thêm kênh SMS cạnh email
- **Security team** muốn thay đổi cách validate input

Khi bốn nhóm người khác nhau có thể yêu cầu thay đổi cùng một class vì bốn lý do khác nhau — class đó đang vi phạm SRP.

---

## Tại sao vi phạm SRP lại nguy hiểm

Thử xem một ví dụ thực tế. Notification team yêu cầu thêm SMS. Mày mở `AppointmentService` ra sửa:

```java
// ❌ Vấn đề — sửa notification logic trong service booking
public AppointmentResponse book(BookAppointmentRequest request) {
    // ... 50 dòng booking logic ...

    // Trước: chỉ có email
    emailService.send(patient.getEmail(), "Booking confirmed", message);
    
    // Sau: thêm SMS
    if (patient.getPhone() != null) {
        smsService.send(patient.getPhone(), message); // dòng mới
    }

    // ... 20 dòng audit log ...
}
```

Mày chỉ thêm ba dòng liên quan đến SMS. Nhưng để làm điều đó, mày phải:

1. Mở file `AppointmentService.java` — file có thể dài 200 dòng
2. Hiểu đủ context xung quanh để không làm vỡ thứ gì
3. Chạy lại toàn bộ test của appointment booking chỉ để verify một thay đổi notification
4. Deploy lại toàn bộ service dù thứ duy nhất thay đổi là notification logic

Và nếu có bug trong SMS? Stack trace sẽ chỉ vào `AppointmentService.book()` — class mà team booking cũng đang dùng. Ai cũng lo, ai cũng phải vào xem, dù phần lớn code trong đó không liên quan.

---

## Tách đúng chỗ

Đây là cách thiết kế lại theo SRP:

```java
// ✅ Tốt hơn — mỗi class có một lý do để thay đổi

// Chỉ care về business rules của việc booking
@Service
public class AppointmentBookingService {
    
    private final AppointmentRepository appointmentRepository;
    private final SlotAvailabilityChecker slotChecker;
    private final AppointmentValidator validator;
    private final ApplicationEventPublisher eventPublisher;

    public AppointmentResponse book(BookAppointmentRequest request) {
        validator.validate(request);
        slotChecker.ensureAvailable(request.getDoctorId(), request.getDate(), request.getSlot());

        Appointment appointment = createAppointment(request);
        appointmentRepository.save(appointment);

        // Publish event — không biết ai sẽ handle, cũng không cần biết
        eventPublisher.publishEvent(new AppointmentBookedEvent(appointment));

        return mapper.toResponse(appointment);
    }
}

// Chỉ care về notification — thêm SMS không ảnh hưởng gì đến booking
@Component
public class AppointmentNotificationHandler {

    @TransactionalEventListener
    public void handleBookingConfirmed(AppointmentBookedEvent event) {
        Appointment appointment = event.getAppointment();
        String message = buildMessage(appointment);
        
        emailService.send(appointment.getPatient().getEmail(), "Booking confirmed", message);
        
        if (appointment.getPatient().getPhone() != null) {
            smsService.send(appointment.getPatient().getPhone(), message);
        }
    }
}

// Chỉ care về audit — thay đổi format log không đụng đến booking hay notification
@Component
public class AppointmentAuditHandler {

    @TransactionalEventListener
    public void handleBookingConfirmed(AppointmentBookedEvent event) {
        auditLogRepository.save(new AuditLog(
            "BOOK_APPOINTMENT",
            event.getAppointment().getPatient().getId(),
            event.getAppointment().getId()
        ));
    }
}
```

Bây giờ notification team muốn thêm SMS: họ chỉ sửa `AppointmentNotificationHandler`. Ops team muốn thêm IP address vào audit: họ chỉ sửa `AppointmentAuditHandler`. Business team muốn thay đổi booking logic: họ chỉ sửa `AppointmentBookingService`.

Ba nhóm có thể làm việc song song trên cùng feature mà không giẫm chân nhau.

---

## Cách nhận ra mày đang vi phạm SRP

Không cần nhớ định nghĩa phức tạp. Chỉ cần để ý ba dấu hiệu:

**Dấu hiệu 1 — "God class":** Class mày có tên quá generic như `AppointmentManager`, `UserHandler`, `SystemService`. Generic name thường là dấu hiệu class đang làm quá nhiều việc — vì mày không nghĩ ra tên cụ thể hơn được.

**Dấu hiệu 2 — Nhiều loại dependency:** Class mày inject vừa repository, vừa emailService, vừa redisTemplate, vừa auditRepository. Nếu dependencies thuộc về nhiều lĩnh vực khác nhau, class đang phục vụ nhiều "chủ" khác nhau.

**Dấu hiệu 3 — Test khó setup:** Khi viết unit test cho class đó, mày phải mock quá nhiều thứ không liên quan. Để test booking logic, mày phải setup emailService mock, smsService mock, auditRepository mock — dù chúng không liên quan gì đến thứ mày đang test.

---

## SRP không yêu cầu mày tạo class cho từng dòng code

Đây là điểm quan trọng cần nhấn mạnh: tách quá nhỏ cũng là một vấn đề.

Nếu mày tách `AppointmentEmailSender`, `AppointmentSmsSender`, `AppointmentPushNotificationSender` thành ba class riêng, rồi một ngày PM yêu cầu "khi gửi notification thì log lại xem kênh nào bị fail" — mày phải sửa ba class đó theo cùng một lý do. Lúc đó tách quá nhỏ đã tạo ra sự phức tạp không cần thiết.

SRP là về **logical cohesion** — những thứ thay đổi cùng nhau vì cùng một lý do nên nằm cùng nhau. Những thứ thay đổi vì lý do khác nhau nên được tách ra.

---

## Takeaway

Lần tới khi mày viết xong một class, hỏi: *"Ai sẽ yêu cầu tao sửa class này? Business team? Ops team? Security team?"* Nếu câu trả lời là nhiều hơn một nhóm — tách ra đi. Mày đang nợ chính mày trong tương lai.

---

*Bài tiếp theo: OCP — mỗi lần thêm feature lại sửa code cũ là thiết kế đang sai*
