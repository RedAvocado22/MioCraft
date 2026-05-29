---
title: "Refactor là gì — và khi nào thì nên làm"
description: "Refactor không phải là viết lại, không phải là thêm feature. Đó là cải thiện cấu trúc code mà không thay đổi behavior — và có test để chứng minh."
category: programming
pubDate: 2024-01-19
series: "Phần 2: Clean Code"
tags: ["refactoring", "clean-code", "best-practices"]
---

Tao từng thấy một team dành cả sprint để "refactor" toàn bộ một module. Kết quả: tên class đẹp hơn, code dễ đọc hơn, architecture ngăn nắp hơn — và ba bug mới xuất hiện trong production. Khách hàng không care code đẹp. Họ chỉ thấy hệ thống sập.

Đó không phải là refactor — đó là viết lại. Và sự khác biệt này cực kỳ quan trọng.

## Refactor thực sự là gì

Định nghĩa chính xác: **Refactor là thay đổi cấu trúc code mà không thay đổi behavior bên ngoài.**

"Behavior bên ngoài" nghĩa là với cùng một input, output phải giống hệt nhau sau khi refactor. Tất nhiên trong thực tế performance có thể thay đổi, log có thể khác — nhưng business logic, API contract, data output phải giữ nguyên.

Đây là lý do test quan trọng trong refactor. Nếu mày không có test, mày không thể biết mình có vô tình thay đổi behavior hay không. Không có test mà refactor là đang bay mù.

```java
// Trước refactor — function dài, logic trộn lẫn
public AppointmentDTO confirmAndNotify(Long appointmentId, Long confirmingDoctorId) {
    Appointment a = appointmentRepository.findById(appointmentId).orElseThrow();
    if (!a.getDoctorId().equals(confirmingDoctorId)) throw new UnauthorizedException();
    if (a.getStatus() != AppointmentStatus.PENDING) throw new InvalidStateException();
    a.setStatus(AppointmentStatus.CONFIRMED);
    a.setConfirmedAt(LocalDateTime.now());
    appointmentRepository.save(a);
    String msg = "Lịch khám của bạn với BS " + doctorRepo.findById(a.getDoctorId()).get().getName()
                + " vào " + a.getDate() + " đã được xác nhận.";
    notificationService.send(a.getPatientId(), msg);
    return appointmentMapper.toDTO(a);
}

// Sau refactor — cùng behavior, cấu trúc tốt hơn
public AppointmentDTO confirmAppointment(Long appointmentId, Long confirmingDoctorId) {
    Appointment appointment = findAppointmentOrThrow(appointmentId);
    validateDoctorAuthorization(appointment, confirmingDoctorId);
    validateAppointmentCanBeConfirmed(appointment);

    appointment.confirm(); // state transition trong entity
    appointmentRepository.save(appointment);

    eventPublisher.publishEvent(new AppointmentConfirmedEvent(appointment));
    return appointmentMapper.toDTO(appointment);
}
```

Cùng input → cùng output. Nhưng structure tốt hơn, testable hơn, và `confirmAndNotify` tách được notification ra khỏi transaction.

## Khi nào nên refactor

Câu trả lời không phải là "khi có sprint riêng." Nó là **liên tục, từng bước nhỏ, trong khi đang làm feature hoặc fix bug**.

Martin Fowler có một cụm từ hay: *"Rule of Three."* Lần đầu làm một thứ, cứ làm. Lần hai làm thứ tương tự, nhăn mặt nhưng vẫn làm. Lần ba — refactor.

Trong thực tế, có ba trigger rõ ràng:

**Trước khi thêm feature.** Nếu codebase hiện tại khiến việc thêm feature khó — refactor trước. Đừng nhét feature vào code đang rối. Hệ quả: feature mới làm code rối hơn, feature tiếp theo càng khó hơn.

**Khi fix bug.** Nếu mày phải đọc code ba lần mới hiểu nó làm gì trước khi fix bug — đó là signal code cần được làm rõ hơn. Fix bug xong, refactor chỗ mày vừa đọc để người sau không phải khổ như mày.

**Khi code review.** Reviewer chỉ ra code khó đọc, tên xấu, function quá dài — đó là cơ hội refactor ngay trong PR, không phải "ticket sau."

## Khi nào KHÔNG nên refactor

**Khi không có test.** Đây là điều kiện cứng. Refactor mà không có test là đang chơi Russian Roulette với production. Nếu codebase không có test mà mày cần refactor — viết test trước, dù chỉ là characterization test để capture behavior hiện tại.

**Khi deadline đang dí.** Refactor lúc deadline là recipe cho disaster. Mày sẽ vừa cố refactor vừa lo release, không đủ attention để verify behavior không đổi.

**Khi scope quá lớn và không chia nhỏ được.** "Refactor toàn bộ service layer" không phải là một task — đó là một project. Nếu mày không thể chia nhỏ thành các bước độc lập mà sau mỗi bước hệ thống vẫn chạy — thì đó không phải là refactor, đó là viết lại.

## Refactor từng bước nhỏ: ví dụ thực tế

Giả sử `DoctorScheduleService` đang có một method 80 dòng. Mày cần thêm feature mới vào đây.

```
Bước 1: Extract method
Tách method 80 dòng thành 4-5 private method có tên rõ ràng.
✓ Chạy test — pass. Deploy nếu cần.

Bước 2: Rename
Rename các biến và parameter đang mơ hồ.
✓ Chạy test — pass. Deploy nếu cần.

Bước 3: Extract class
Nếu một nhóm method cùng làm về một concern (ví dụ: availability calculation)
→ extract ra AvailabilityCalculator riêng.
✓ Chạy test — pass. Deploy nếu cần.

Bước 4: Thêm feature mới vào codebase đã được dọn dẹp.
```

Sau mỗi bước, hệ thống chạy được. Không có bước nào "tao đang refactor, hệ thống tạm sập." Đây là điều phân biệt refactor chuyên nghiệp với viết lại liều.

## Refactor không phải là trả technical debt

Đây là một nhầm lẫn phổ biến. Technical debt là những quyết định mày cố tình đưa ra để đổi tốc độ ngắn hạn lấy quality dài hạn — mày biết đó là debt khi mày tạo ra nó.

Refactor thì khác. Refactor là làm cho code hiện tại tốt hơn — không nhất thiết vì nó là debt, mà vì mày hiểu domain hơn bây giờ so với lúc viết. Code từ hai tháng trước reflect hiểu biết từ hai tháng trước. Refactor là cập nhật code theo hiểu biết hiện tại.

Cả hai đều cần thiết. Nhưng đừng nhầm lẫn chúng với nhau.

## Takeaway

Lần tiếp theo mày đụng vào một function để fix bug hoặc thêm feature, áp dụng rule này: *"Leave the code cleaner than you found it."* Không cần làm thành sprint riêng. Chỉ cần đặt tên một biến rõ hơn, tách một private method, xóa một comment thừa. Cộng dồn lại theo thời gian, đó là cách codebase không bị thối.

---

*Bài tiếp theo: Deadline dí không cho phép mày viết code bừa — thực ra là sao?*
