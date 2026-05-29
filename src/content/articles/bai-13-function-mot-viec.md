---
title: "Function làm \"một việc\" — nhưng \"một việc\" nghĩa là gì?"
description: "SRP nghe có vẻ đơn giản — nhưng hầu hết dev định nghĩa \"một việc\" sai. Đây là cách hiểu đúng để áp dụng thật sự."
category: programming
pubDate: 2024-01-13
series: "Phần 2: Clean Code"
tags: ["clean-code", "SRP", "functions"]
---

"Function nên làm một việc." Mày đã nghe câu này rồi. Tao cũng đã nghe. Vấn đề là không ai giải thích "một việc" nghĩa là gì — vì nó không có định nghĩa tuyệt đối. Và đó là lý do câu rule tưởng đơn giản này bị áp dụng sai nhiều đến vậy.

Có người split function đến mức mỗi function chỉ có hai dòng. Có người nghĩ "một việc" là "một use case hoàn chỉnh" nên nhét cả đống logic vào một chỗ. Cả hai đều sai.

## Định nghĩa thực dụng

Thay vì định nghĩa triết học, tao dùng cái test này: **Mày có thể mô tả function bằng một câu duy nhất, không dùng "và" không?**

Nếu câu mô tả của mày có "và" — function đó đang làm nhiều hơn một việc.

```java
// ❌ Vấn đề — làm 3 việc
// "Tính tiền bảo hiểm VÀ cập nhật trạng thái appointment VÀ gửi notification"
public void processAppointment(Long appointmentId) {
    Appointment appointment = appointmentRepository.findById(appointmentId)
        .orElseThrow(() -> new AppointmentNotFoundException(appointmentId));

    // Tính tiền bảo hiểm
    InsuranceCoverage coverage = insuranceService.calculate(appointment.getPatientId());
    BigDecimal patientShare = appointment.getTotalFee().subtract(coverage.getCoveredAmount());
    appointment.setPatientPaymentAmount(patientShare);

    // Cập nhật trạng thái
    appointment.setStatus(AppointmentStatus.CONFIRMED);
    appointmentRepository.save(appointment);

    // Gửi notification
    notificationService.sendConfirmationToPatient(appointment);
    notificationService.sendReminderToDoctor(appointment);
}
```

Đọc function này, mày thấy nó "làm một việc" — xử lý appointment. Nhưng thực ra nó đang làm ba việc ở ba layer khác nhau: tính toán tài chính, state management, và side effect (notification). Đây là vấn đề.

## Tại sao lại là vấn đề?

Khi một function làm nhiều việc, mày không thể:

**Test từng phần độc lập.** Nếu muốn test logic tính bảo hiểm, mày bắt buộc phải mock cả notification service. Không liên quan nhưng vẫn phải làm.

**Reuse từng phần.** Nếu có chỗ khác chỉ cần tính tiền bảo hiểm mà không cần confirm appointment, mày không thể dùng lại.

**Thay đổi từng phần an toàn.** Nếu logic gửi notification thay đổi, mày phải vào function này sửa — và có nguy cơ ảnh hưởng đến logic tính tiền nằm ngay bên cạnh.

**Đặt tên rõ ràng.** Không có cái tên nào mô tả đúng function này mà không dùng "và."

## Split đúng cách

```java
// ✅ Tốt hơn — mỗi function một trách nhiệm
public void confirmAppointment(Long appointmentId) {
    Appointment appointment = findAppointmentOrThrow(appointmentId);
    BigDecimal patientShare = calculatePatientPaymentShare(appointment);

    appointment.setPatientPaymentAmount(patientShare);
    appointment.setStatus(AppointmentStatus.CONFIRMED);
    appointmentRepository.save(appointment);

    // Side effect được tách rõ — đây là @TransactionalEventListener territory
    eventPublisher.publishEvent(new AppointmentConfirmedEvent(appointment));
}

private BigDecimal calculatePatientPaymentShare(Appointment appointment) {
    InsuranceCoverage coverage = insuranceService.calculate(appointment.getPatientId());
    return appointment.getTotalFee().subtract(coverage.getCoveredAmount());
}

private Appointment findAppointmentOrThrow(Long appointmentId) {
    return appointmentRepository.findById(appointmentId)
        .orElseThrow(() -> new AppointmentNotFoundException(appointmentId));
}
```

Tại sao `calculatePatientPaymentShare` là private? Vì nó là implementation detail của `confirmAppointment` — không cần expose ra ngoài. Nếu sau này logic này phức tạp hơn và cần test riêng, lúc đó nâng lên package-private hoặc extract ra class riêng. Đừng over-engineer trước.

## Một mức độ trừu tượng

Có một cách khác để hiểu "một việc": **tất cả các bước trong function nên ở cùng một mức độ trừu tượng**.

```java
// ❌ Vấn đề — trộn lẫn nhiều mức trừu tượng
public void bookAppointment(BookingRequest request) {
    // Mức cao: business logic
    validateDoctorAvailability(request.getDoctorId(), request.getDate());

    // Mức thấp: implementation detail bỗng dưng xuất hiện
    String redisKey = "slot:" + request.getDoctorId() + ":" + request.getDate() + ":" + request.getTimeSlot();
    Boolean isAvailable = redisTemplate.opsForValue().setIfAbsent(redisKey, "BOOKED", 10, TimeUnit.MINUTES);
    if (Boolean.FALSE.equals(isAvailable)) {
        throw new SlotAlreadyBookedException();
    }

    // Mức cao: business logic lại
    Appointment appointment = createAppointmentFromRequest(request);
    appointmentRepository.save(appointment);
}
```

Người đọc đang đi từ "validate availability" — high-level business — đột nhiên thấy Redis key formatting — low-level infra — rồi lại nhảy về "create appointment." Đây là dấu hiệu function này đang trộn lẫn concerns.

```java
// ✅ Tốt hơn — consistent level of abstraction
public void bookAppointment(BookingRequest request) {
    validateDoctorAvailability(request.getDoctorId(), request.getDate());
    lockAppointmentSlot(request); // Redis logic ẩn sau đây
    Appointment appointment = createAppointmentFromRequest(request);
    appointmentRepository.save(appointment);
}

private void lockAppointmentSlot(BookingRequest request) {
    String redisKey = buildSlotKey(request);
    Boolean locked = redisTemplate.opsForValue()
        .setIfAbsent(redisKey, "BOOKED", 10, TimeUnit.MINUTES);
    if (Boolean.FALSE.equals(locked)) {
        throw new SlotAlreadyBookedException();
    }
}
```

Bây giờ `bookAppointment` đọc như một câu chuyện ở mức business. Chi tiết kỹ thuật nằm trong các private method bên dưới.

## Khi nào thì quá nhỏ?

Split quá nhỏ cũng là vấn đề. Nếu mày phải nhảy qua năm function để hiểu một luồng logic đơn giản — mày đã split quá tay.

Rule of thumb: private helper method chỉ đáng tạo khi nó được dùng ở nhiều chỗ, hoặc khi nó có logic đủ phức tạp để tách biệt giúp `readability` tăng lên rõ ràng. Nếu nó chỉ là ba dòng code hiển nhiên — cứ để inline.

```java
// ❌ Over-split vô nghĩa
public void saveAppointment(Appointment appointment) {
    prepareAppointmentForSaving(appointment);
    persistAppointment(appointment);
}

private void prepareAppointmentForSaving(Appointment appointment) {
    appointment.setCreatedAt(LocalDateTime.now());
}

private void persistAppointment(Appointment appointment) {
    appointmentRepository.save(appointment);
}

// ✅ Để inline nếu không phức tạp
public void saveAppointment(Appointment appointment) {
    appointment.setCreatedAt(LocalDateTime.now());
    appointmentRepository.save(appointment);
}
```

## Takeaway

Lấy một service method dài nhất trong HMS của mày và áp dụng bài test câu "và": đọc method đó, thử mô tả nó bằng một câu. Nếu mày dùng "và" — identify xem nó đang làm mấy việc, và quyết định việc nào nên tách ra.

---

*Bài tiếp theo: Khi nào comment là dấu hiệu code đang có vấn đề*
