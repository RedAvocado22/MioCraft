---
title: "SOLID — code chạy được vẫn fail vì mày chưa hiểu cái này"
description: "SOLID không phải checklist để tick vào. Đó là tư duy về cách tổ chức code để nó không sụp đổ khi requirement thay đổi."
category: programming
pubDate: 2024-02-02
series: "Phần 4: SOLID"
tags: ["SOLID", "OOP", "design-principles"]
---

Có một loại bug đặc biệt. Không phải NullPointerException. Không phải timeout. Không bao giờ xuất hiện lúc test, không bao giờ bị catch bởi một cái try-catch nào. Nhưng nó giết project chậm rãi, đều đặn, qua từng sprint.

Loại bug đó có tên: **rigid code** — code cứng đến mức mỗi lần thêm một feature, mày phải sửa năm chỗ khác. Code mà mày không dám refactor vì không biết sửa chỗ này sẽ break gì chỗ kia. Code mà sau 6 tháng, chính mày cũng không còn tự tin mình hiểu nó hoạt động thế nào.

SOLID không phải một lý thuyết để đọc rồi gật đầu. Nó là bộ năm nguyên tắc được đúc kết từ hàng nghìn giờ maintain code xấu — để giúp mày không phải lặp lại những sai lầm đó.

---

## SOLID là gì và tại sao nó xuất hiện

Robert C. Martin — thường được gọi là Uncle Bob — viết về những nguyên tắc này vào đầu những năm 2000, sau nhiều năm quan sát codebase của hàng chục công ty. Ông nhận ra rằng code xấu không phải ngẫu nhiên — nó xấu theo những pattern rất cụ thể và lặp lại.

SOLID là viết tắt của năm nguyên tắc:

- **S** — Single Responsibility Principle
- **O** — Open/Closed Principle
- **L** — Liskov Substitution Principle
- **I** — Interface Segregation Principle
- **D** — Dependency Inversion Principle

Mỗi nguyên tắc giải quyết một loại đau khác nhau. Nhưng tất cả đều hướng đến một mục tiêu chung: **code dễ thay đổi mà không làm vỡ những thứ đã hoạt động.**

---

## Tại sao sinh viên thường bỏ qua SOLID

Lý do đơn giản: trong môi trường học, requirement không thay đổi. Thầy giáo ra đề một lần, mày code một lần, submit một lần. Không ai quay lại yêu cầu mày "thêm tính năng export PDF vào hệ thống mày viết hồi tháng trước."

Nhưng trong production, **requirement thay đổi là mặc định, không phải ngoại lệ.** Sáng PM nói "chỉ cần basic" — chiều PM nói "thêm cái này được không?" Sprint 1 có 3 loại payment — Sprint 5 có 7 loại. Đây không phải PM thay đổi ý kiến. Đây là product evolving.

Code không được thiết kế để thay đổi sẽ bắt đầu kháng cự. Và mỗi lần kháng cự, mày sẽ tìm cách hack xung quanh nó thay vì giải quyết đúng gốc rễ. Sau 6 tháng, codebase trở thành một mê cung mà không ai muốn đụng vào.

---

## Một ví dụ để hiểu vấn đề

Đây là một `AppointmentService` điển hình ở giai đoạn đầu HMS — khi mọi thứ vừa "cần chạy được":

```java
// ❌ Vấn đề — class đang làm quá nhiều việc
@Service
public class AppointmentService {

    public AppointmentResponse book(BookAppointmentRequest request) {
        // validate input
        if (request.getDoctorId() == null) throw new BadRequestException("Missing doctorId");
        if (request.getDate().isBefore(LocalDate.now())) throw new BadRequestException("Past date");

        // kiểm tra slot còn không
        String redisKey = "slot:" + request.getDoctorId() + ":" + request.getDate() + ":" + request.getSlot();
        if (Boolean.TRUE.equals(redisTemplate.hasKey(redisKey))) {
            throw new ConflictException("Slot already booked");
        }

        // tạo appointment
        Appointment appointment = new Appointment();
        appointment.setPatient(patientRepository.findById(request.getPatientId()).orElseThrow());
        appointment.setDoctor(doctorRepository.findById(request.getDoctorId()).orElseThrow());
        appointment.setDate(request.getDate());
        appointment.setStatus(AppointmentStatus.PENDING);
        appointmentRepository.save(appointment);

        // gửi notification
        String message = "Lịch hẹn ngày " + request.getDate() + " đã được đặt thành công";
        notificationRepository.save(new Notification(request.getPatientId(), message));
        emailService.send(patient.getEmail(), "Booking confirmed", message);

        // ghi audit log
        auditLogRepository.save(new AuditLog("BOOK_APPOINTMENT", request.getPatientId()));

        return mapper.toResponse(appointment);
    }
}
```

Code này chạy. Nhưng thử tưởng tượng 6 tháng sau:

- PM yêu cầu thêm SMS notification cạnh email
- Team muốn thay Redis bằng database lock vì Redis đang có vấn đề
- QA yêu cầu unit test riêng cho logic validation
- Security team yêu cầu audit log phải có IP address

Mày sẽ sửa tất cả những thứ đó trong cùng một method, trong cùng một class. Và mỗi lần sửa, mày có thể break bất kỳ thứ gì khác trong method đó mà không hay.

---

## Năm nguyên tắc — năm góc nhìn khác nhau về cùng một vấn đề

**SRP** hỏi: *"Class này đang phục vụ bao nhiêu chủ?"* Nếu nhiều hơn một — nó đang làm quá nhiều việc.

**OCP** hỏi: *"Thêm tính năng mới có bắt mày sửa code cũ không?"* Nếu có — thiết kế chưa đủ mở.

**LSP** hỏi: *"Subclass của mày có thật sự là một phiên bản của parent không?"* Nếu không — mày đang kế thừa sai.

**ISP** hỏi: *"Interface mày implement có method nào mày không dùng không?"* Nếu có — interface đang quá béo.

**DIP** hỏi: *"Business logic có đang phụ thuộc trực tiếp vào infrastructure không?"* Nếu có — dependency đang chảy sai chiều.

Năm câu hỏi đó, mày hỏi đủ mỗi lần thiết kế một class, thì code sẽ cứng nhắc ít đi rất nhiều.

---

## SOLID không phải checklist

Đây là điều quan trọng nhất cần hiểu trước khi đọc tiếp: **SOLID là nguyên tắc, không phải quy tắc cứng.**

Áp dụng SRP mù quáng có thể khiến mày tách code thành hàng chục class nhỏ không ai hiểu tại sao chúng tồn tại. Áp dụng OCP quá sớm có thể tạo ra abstraction layer không cần thiết. Trong SOLID có tension — đôi khi tuân theo nguyên tắc này sẽ vi phạm nguyên tắc kia nếu không cân nhắc.

P04/Bài 07 ở cuối phần này sẽ nói về điều đó. Nhưng trước tiên, mày cần hiểu từng nguyên tắc đủ sâu để biết mình đang trade-off gì — không phải áp dụng nó như một công thức.

---

## Takeaway

Lần tới khi mày viết xong một class và nó chạy đúng, đặt câu hỏi này: *"Nếu có năm thứ khác nhau cần thay đổi trong class này theo năm lý do khác nhau — tao có dám sửa một mà không sợ break bốn cái còn lại không?"* Nếu không — đó là dấu hiệu mày cần đọc tiếp.

---

*Bài tiếp theo: SRP — một class ôm quá nhiều là mầm mống thảm họa*
