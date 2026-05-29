---
title: "Optional<T> — khi nào nên dùng, khi nào không"
description: "Optional không phải cách viết null an toàn cho mọi chỗ. Return type có lý, field và parameter thì gần như luôn sai — và senior reject vì lý do đó."
category: programming
pubDate: 2026-05-22
series: "Phần 2: Clean Code"
tags: ["clean-code", "java", "optional", "null"]
---


Có một phase mà hầu hết junior Java đều trải qua: vừa học `Optional`, liền bọc mọi thứ bằng `Optional`. Entity có field `Optional<String> phoneNumber`. Service method nhận `Optional<UUID> doctorId`. Repository trả về `Optional` — cái đó thì đúng — nhưng rồi người ta chain `.map().flatMap()` ba tầng cho một logic tìm bệnh nhân theo mã hồ sơ.

Code compile. Test pass. Senior comment một dòng: *"Đừng dùng Optional như thế."*

Không phải vì senior ghét Java 8. Mà vì `Optional` được thiết kế cho **một use case cụ thể**, và dùng sai chỗ tạo ra code khó đọc hơn null check thông thường.

---

## Optional sinh ra để làm gì

`Optional<T>` là container có thể **có hoặc không có** giá trị — nhưng quan trọ hơn, nó buộc **người gọi** phải xử lý trường hợp thiếu giá trị ngay tại chỗ gọi.

Use case chính mà Java team recommend: **return type** của method có thể không trả về gì.

```java
// ✅ Repository — absence of result là một outcome hợp lệ
public interface PatientRepository extends JpaRepository<Patient, UUID> {
    Optional<Patient> findByMedicalRecordNumber(String recordNumber);
}
```

Khi `PatientService` gọi method này, compiler và API contract nói rõ: *"Có thể không tìm thấy — mày phải quyết định xử lý thế nào."*

```java
public PatientResponse getByRecordNumber(String recordNumber) {
    return patientRepository.findByMedicalRecordNumber(recordNumber)
        .map(patientMapper::toResponse)
        .orElseThrow(() -> new NotFoundException("PATIENT_NOT_FOUND",
            "Không tìm thấy bệnh nhân với mã hồ sơ: " + recordNumber));
}
```

Đây là chỗ `Optional` làm đúng việc: thay vì return `null` và để caller quên check, API **document** sự không chắc chắn ngay trong signature.

---

## Field `Optional` — gần như luôn sai

```java
// ❌ Entity với Optional field
@Entity
public class Patient {
    @Id
    private UUID id;
    private Optional<String> emergencyContactPhone; // đừng
}
```

Vấn đề không nằm ở syntax. Vấn đề nằm ở **JPA và database không hiểu Optional**.

- Column `emergency_contact_phone` nullable trong DB — giá trị "không có" đã được biểu diễn bằng `NULL`, không cần thêm một lớp wrapper
- Hibernate map `Optional` không intuitive; một số version cần converter, một số behavior khó đoán
- Mọi chỗ đọc entity phải `.orElse()` hoặc `.isPresent()` — noise không mang lại giá trị gì so với `String phone` có thể null, hoặc tốt hơn: nullable column + validation ở service layer

```java
// ✅ Nullable field — DB và Java đã có convention cho "không có giá trị"
@Entity
public class Patient {
    private String emergencyContactPhone; // null = chưa cung cấp
}
```

Nếu mày muốn **bắt buộc** phải có số điện thoại khẩn cấp trước khi tạo hồ sơ — đó là business rule, enforce ở `PatientService.create()`, không phải bằng cách bọc field trong `Optional`.

---

## Parameter `Optional` — API design tệ

```java
// ❌ Caller phải wrap mọi thứ
public List<AppointmentResponse> search(
    Optional<UUID> doctorId,
    Optional<LocalDate> fromDate,
    Optional<AppointmentStatus> status
) { ... }
```

Người gọi viết:

```java
service.search(
    Optional.of(doctorId),
    Optional.empty(),
    Optional.of(AppointmentStatus.CONFIRMED)
);
```

Verbose. Khó đọc. Và không rõ hơn overload hay nullable parameter.

Các cách tốt hơn cho optional **input**:

```java
// ✅ Overload hoặc builder cho filter phức tạp
public List<AppointmentResponse> searchByDoctor(UUID doctorId, LocalDate fromDate) { ... }

public List<AppointmentResponse> search(AppointmentSearchCriteria criteria) { ... }

// record với nullable fields — explicit trong một object
public record AppointmentSearchCriteria(
    UUID doctorId,           // null = không filter theo doctor
    LocalDate fromDate,
    AppointmentStatus status
) {}
```

Rule of thumb từ Effective Java: **Optional dành cho return type**. Parameter optional dùng overload, `null` có document rõ (ít dùng), hoặc criteria object.

---

## Collection không bao giờ là Optional

```java
// ❌ Optional<List<Prescription>> — vô nghĩa
Optional<List<Prescription>> getPrescriptions(UUID appointmentId);
```

List rỗng và "không có list" là hai khái niệm hiếm khi khác nhau trong API. Trả `List.of()` hoặc `Collections.emptyList()` — caller loop bình thường, không cần `.orElse(List.of())`.

---

## Khi nào không cần Optional dù là return type

Nếu absence of value là **exceptional** — tức là caller hợp lý luôn expect có data — đừng dùng Optional. Throw exception rõ ràng hoặc dùng `getById` trả entity trực tiếp (và document rằng nó throw nếu không tìm thấy).

```java
// ✅ getById — id phải tồn tại, không tồn tại là lỗi hệ thống hoặc client gửi sai
public Appointment getById(UUID id) {
    return appointmentRepository.findById(id)
        .orElseThrow(() -> new NotFoundException("APPOINTMENT_NOT_FOUND", id));
}
```

`Optional` hợp lý khi **không tìm thấy là outcome bình thường** — ví dụ `findByEmail` khi check email đã đăng ký chưa. `getById` khi client gửi UUID từ URL thì không tìm thấy thường là 404, không phải branch logic phức tạp — `orElseThrow` vẫn ổn, nhưng return `Optional` từ repository là đủ, service convert sang exception một chỗ.

---

## Takeaway

`Optional` trả lời câu hỏi: *"Method này có thể không có kết quả — mày đã xử lý chưa?"* Dùng nó ở **return type** khi absence là hợp lệ. Đừng đưa vào entity field, đừng làm parameter, đừng bọc collection. Nếu mày thấy mình viết `Optional<Optional<...>>` hoặc `.get()` không có `orElseThrow` — đó là dấu hiệu đang lạm dụng.

---

*Bài tiếp theo: Secrets không được hardcode — Spring profiles và env vars.*
