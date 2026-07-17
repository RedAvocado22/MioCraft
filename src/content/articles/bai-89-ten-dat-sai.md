---
title: "Một cái tên đặt sai gây ra bug production"
description: "isActive, isEnabled, isDeleted — ba field có vẻ tương tự nhưng semantic khác nhau. Khi developer mới hiểu nhầm, logic sai được build lên trên đó, và bug chỉ xuất hiện trong production."
category: system-design
pubDate: 2024-03-30
series: "Phần 10: Case Studies thực tế"
tags: ["case-study", "naming", "clean-code", "bugs"]
---

Đây là bug mình tìm mất hai tiếng. Không phải vì logic phức tạp. Không phải vì race condition hay distributed state. Mà vì một cái tên.

Trong HMS, có một method tên `getActiveAppointments`. Một developer đọc tên này, hiểu là "lấy các appointment đang active", và dùng nó để filter danh sách hiển thị cho bác sĩ trước giờ khám. Hợp lý.

Vấn đề: `getActiveAppointments` không trả về appointment với status `ACTIVE`. Nó trả về appointment *chưa bị cancel* — bao gồm cả `PENDING`, `CONFIRMED`, `COMPLETED`, `IN_PROGRESS`. Tất cả appointment không phải `CANCELLED`.

Bác sĩ nhìn thấy một danh sách lẫn lộn lịch hôm nay, lịch tuần trước đã xong, và lịch đang chờ confirm — tất cả gộp lại, không theo thứ tự nào có nghĩa.

---

## Cái tên là một contract

Khi bạn đặt tên cho một method, bạn đang tạo ra một **contract ngầm** với người sẽ đọc code sau bạn. Người đó sẽ đọc tên, suy ra behavior, và quyết định có dùng method đó hay không — thường mà không đọc implementation.

`getActiveAppointments` violate contract của nó theo cả hai hướng:

**Quá hẹp trong tên, quá rộng trong behavior:** Tên gợi ý chỉ status `ACTIVE`, nhưng thực ra là tất cả non-cancelled.

**Không nói gì về scope:** Active theo nghĩa gì? Theo thời gian? Theo trạng thái? Của doctor nào? Của tất cả?

Người viết method này biết rõ mình muốn gì — tất cả appointment chưa cancel. Nhưng cái tên không truyền đạt được điều đó. Và ba tháng sau, một người khác (hoặc chính bạn) đọc tên và hiểu sai.

---

## Naming bug phổ biến trong HMS codebase

```java
// ❌ Tên gây hiểu lầm — getActive ngụ ý filter theo status ACTIVE
// Thực ra là filter theo !cancelled
public List<Appointment> getActiveAppointments(UUID doctorId) {
    return appointmentRepository.findByDoctorIdAndStatusNot(
        doctorId, AppointmentStatus.CANCELLED
    );
}

// ✅ Tên mô tả đúng behavior
public List<Appointment> getNonCancelledAppointments(UUID doctorId) {
    return appointmentRepository.findByDoctorIdAndStatusNot(
        doctorId, AppointmentStatus.CANCELLED
    );
}

// Hoặc nếu intent là "lịch còn hiệu lực để bác sĩ cần quan tâm":
public List<Appointment> getPendingAndConfirmedAppointments(UUID doctorId) {
    return appointmentRepository.findByDoctorIdAndStatusIn(
        doctorId,
        List.of(AppointmentStatus.PENDING, AppointmentStatus.CONFIRMED)
    );
}
```

Hai version cuối dài hơn. Nhưng dài hơn ở tên method thì tốt — nó encode thông tin. Dài hơn ở logic phức tạp thì mới là vấn đề.

---

## Ba loại naming bug hay gặp

**Loại 1: Tên quá vague**

```java
// ❌ "process" không nói gì
public void processAppointment(UUID appointmentId) { ... }

// ✅ Rõ ràng về intent
public void confirmAndNotifyPatient(UUID appointmentId) { ... }
public void cancelWithRefund(UUID appointmentId, String reason) { ... }
```

**Loại 2: Tên phủ định — khó đọc khi nesting**

```java
// ❌ Double negative trong condition
if (!appointment.isNotCancelled()) { ... }

// ✅ Positive naming
if (appointment.isCancelled()) { ... }

// Entity method nên có cả hai nếu cần, nhưng đặt tên consistent
public boolean isCancelled() {
    return status == AppointmentStatus.CANCELLED;
}

public boolean isActive() {
    // "active" trong domain context là CONFIRMED hoặc IN_PROGRESS
    // Không phải "not cancelled" — đây là hai thứ khác nhau
    return status == AppointmentStatus.CONFIRMED
        || status == AppointmentStatus.IN_PROGRESS;
}
```

**Loại 3: Tên đúng với lúc viết, sai sau khi refactor**

```java
// Ban đầu: method chỉ send email
public void sendNotification(UUID appointmentId) {
    emailService.sendConfirmation(appointmentId);
}

// Sau khi thêm SMS — tên không được update
public void sendNotification(UUID appointmentId) {
    emailService.sendConfirmation(appointmentId);
    smsService.sendConfirmation(appointmentId);  // Mới thêm
    // Tên vẫn là "sendNotification" — không nói gì về channel
}

// ✅ Tên phản ánh behavior hiện tại
public void sendConfirmationViaAllChannels(UUID appointmentId) { ... }
// Hoặc nếu channel là configurable:
public void sendConfirmation(UUID appointmentId) { ... } // Channel là implementation detail
```

---

## Naming trong repository layer — một nơi đặc biệt dễ sai

Spring Data JPA cho phép bạn viết method tên từ query. Đây là power feature — nhưng cũng là nơi naming bug hay xuất hiện nhất vì tên method phải match query, và query có thể phức tạp.

```java
// ❌ Tên không reflect được hết điều kiện của query
// Đọc tên: "find by doctor and date"
// Thực ra query: by doctor AND date AND status = CONFIRMED AND not deleted
List<Appointment> findByDoctorIdAndDate(UUID doctorId, LocalDate date);

// ✅ Nếu dùng derived query: tên phản ánh đầy đủ điều kiện
List<Appointment> findByDoctorIdAndDateAndStatusAndDeletedFalse(
    UUID doctorId, LocalDate date, AppointmentStatus status
);

// Hoặc nếu tên quá dài, dùng @Query với tên method mô tả intent
@Query("SELECT a FROM Appointment a WHERE a.doctor.id = :doctorId " +
       "AND a.date = :date AND a.status = 'CONFIRMED' AND a.deleted = false")
List<Appointment> findConfirmedByDoctorAndDate(
    @Param("doctorId") UUID doctorId,
    @Param("date") LocalDate date
);
```

---

## Naming là communication, không phải convention

Có một quan niệm sai lầm: naming chỉ là "đặt theo convention" — camelCase, prefix is/get/set, etc. Thực ra, naming tốt là về **truyền đạt intent đúng với người đọc**.

Câu hỏi bạn nên hỏi khi đặt tên:

- Nếu mình đọc tên này mà không đọc implementation, mình có hiểu đúng nó làm gì không?
- Tên này có phân biệt được với những method tương tự không? (`getAppointments` vs `getActiveAppointments` vs `getTodaysAppointments` — ba thứ khác nhau)
- Khi behavior thay đổi, tên có cần được update theo không? Nếu có, đó là dấu hiệu tên đang encode behavior thay vì intent.

Đặt tên theo intent thay vì implementation: `sendConfirmation` tốt hơn `sendEmailAndSms` — vì khi thêm push notification, tên đầu vẫn đúng, tên sau thì không.

---

## Takeaway

Một cái tên sai không crash hệ thống ngay. Nó âm thầm tạo ra mental model sai trong đầu của người đọc — và cái mental model đó sẽ dẫn đến một quyết định sai trong tương lai. Đặt tên đúng không phải là perfectionism. Nó là documentation rẻ nhất và hiệu quả nhất bạn có thể viết.

---

*Bài tiếp theo: Behind the feature — nút "Book Appointment" ẩn chứa bao nhiêu hệ thống phía sau*
