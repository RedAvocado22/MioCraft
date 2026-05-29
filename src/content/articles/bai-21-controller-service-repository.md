---
title: "Tại sao Controller/Service/Repository thối theo thời gian"
description: "Pattern 3 layer quen thuộc này không sai — nhưng nếu không hiểu đúng mục đích, nó sẽ biến thành nơi chứa mọi thứ và không ai dọn được."
category: architecture
pubDate: 2024-01-21
series: "Phần 3: Kiến trúc phần mềm"
tags: ["architecture", "layered-architecture", "spring-boot"]
---

Mọi project Spring Boot đều bắt đầu sạch sẽ.

Tuần đầu tiên: `AppointmentController` nhận request, `AppointmentService` xử lý logic, `AppointmentRepository` truy vấn database. Ba layer rõ ràng, đẹp như sách giáo khoa. Senior nhìn vào gật đầu.

Sáu tháng sau: `AppointmentService` có 800 dòng. Trong đó có logic validate, logic tính phí, logic gửi notification, logic check insurance, logic cập nhật doctor schedule — tất cả nằm trong cùng một class. Không ai dám sửa vì không ai hiểu hết nó làm gì. Và mày biết điều kỳ lạ không? Kiến trúc vẫn đúng theo sách — vẫn ba layer, vẫn Controller/Service/Repository. Nhưng nó đã thối rữa từ bên trong mà không ai nhận ra.

---

## Ba layer giải quyết một vấn đề, không phải mọi vấn đề

Layered Architecture — Controller/Service/Repository — ra đời để giải quyết một vấn đề cụ thể: **tách biệt mối quan tâm theo chiều dọc**. Controller không được biết SQL. Repository không được biết HTTP. Đó là ý tưởng cốt lõi, và nó đúng.

Nhưng kiến trúc này không nói gì về việc chia business logic như thế nào *bên trong* Service layer. Nó không ngăn mày nhét toàn bộ hệ thống vào một `AppointmentService`. Không có quy tắc nào trong Layered Architecture bảo mày "đây, một service chỉ được phép làm một loại việc." Nó chỉ nói Controller không query DB trực tiếp — hết.

Vậy nên khi hệ thống lớn dần, service bắt đầu hút tất cả mọi thứ vào. Một feature mới? Thêm method vào `AppointmentService`. Logic phức tạp hơn? Thêm điều kiện vào method đó. Cần gửi notification? Inject `NotificationService` vào — cũng trong `AppointmentService`. Theo thời gian, service trở thành một cái túi đựng mọi thứ có liên quan đến Appointment.

---

## Vấn đề thật sự không phải là số dòng

Khi mày thấy một service 800 dòng, phản xạ đầu tiên thường là "dài quá, cần tách ra." Nhưng đó là nhìn vào triệu chứng, không phải nguyên nhân.

Vấn đề thật sự là **service đang vi phạm Single Responsibility ở cấp độ domain**, không phải cấp độ code. Hãy nhìn vào `AppointmentService` sau sáu tháng phát triển:

```java
@Service
public class AppointmentService {

    // Validation logic
    public void validateAppointmentSlot(UUID doctorId, LocalDate date, int slot) { ... }
    public boolean isPatientEligible(UUID patientId) { ... }

    // Booking logic
    public AppointmentResponse bookAppointment(BookingRequest request) { ... }
    public void cancelAppointment(UUID appointmentId) { ... }

    // Notification logic — tại sao cái này lại ở đây?
    private void sendBookingConfirmation(Appointment appointment) { ... }
    private void notifyDoctor(Appointment appointment) { ... }

    // Insurance logic — và cái này?
    private boolean checkInsuranceCoverage(UUID patientId, String treatmentCode) { ... }
    private BigDecimal calculateCopay(UUID patientId, BigDecimal totalAmount) { ... }

    // Schedule management — tại sao service Appointment lại manage Schedule?
    private void decrementAvailableSlots(UUID scheduleId) { ... }
    private void releaseSlot(UUID scheduleId) { ... }
}
```

Nhìn vào cái này và hỏi: *nếu logic tính insurance thay đổi, tao cần sửa file nào?* `AppointmentService`. *Nếu cách gửi notification thay đổi?* `AppointmentService`. *Nếu logic quản lý slot của doctor thay đổi?* `AppointmentService`.

Một class bị ảnh hưởng bởi thay đổi từ ba đến bốn nguồn khác nhau là dấu hiệu rõ ràng: nó đang làm quá nhiều việc, và những việc đó không thuộc về nó.

---

## Tại sao nó thối theo thời gian — không phải lúc ban đầu

Điều thú vị là kiến trúc này không sai ngay từ đầu. Khi project mới bắt đầu, `AppointmentService` nhỏ gọn, logic đơn giản — ba layer hoàn toàn đủ dùng. Vấn đề là kiến trúc này không có cơ chế chống lại *entropy*.

Mỗi lần thêm feature, developer chọn con đường ít kháng cự nhất: thêm vào service hiện tại. Không ai viết một class mới chỉ để thêm hai method. Không ai nghĩ xa đến mức "à, thằng insurance này nên tách ra riêng." Deadline dí, logic nhỏ, thêm vào thôi.

Rồi đến lúc cái logic "nhỏ" đó phình to. Và lúc đó thì việc tách ra đã tốn gấp mười lần công sức — vì nó đã bị coupled vào mọi thứ xung quanh.

Ba layer không sai. Nhưng ba layer là điểm bắt đầu, không phải điểm đến. Hệ thống đủ lớn cần thêm quy tắc để biết *bên trong* Service layer, ai chịu trách nhiệm cho cái gì. Đó là lý do Clean Architecture — và các biến thể của nó — tồn tại.

---

## Takeaway

Lần tới khi mày định thêm một method vào một service đang có sẵn, dừng lại và hỏi: *method này giải quyết vấn đề của ai — Appointment, hay của Insurance, hay của Notification?* Nếu câu trả lời không phải Appointment, nó không thuộc về đây.

---

*Bài tiếp theo: Layered Architecture không phải lúc nào cũng đúng*
