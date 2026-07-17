---
title: "Business logic đặt sai chỗ — hệ thống sẽ trả giá"
description: "Business logic nằm trong Controller, trong SQL query, hay trong UI — đó là technical debt không thể tránh khỏi. Và nó tích lũy theo thời gian."
category: architecture
pubDate: 2024-01-23
series: "Phần 3: Kiến trúc phần mềm"
tags: ["architecture", "business-logic", "clean-architecture"]
---

Có một bug kiểu này xuất hiện trong hầu hết mọi hệ thống enterprise: cùng một rule nghiệp vụ, nhưng behavior lại khác nhau tùy entry point.

Ở HMS, quy tắc là: một bệnh nhân không thể đặt lịch hẹn nếu có appointment đang ở trạng thái `CONFIRMED` chưa hoàn thành. Nghe đơn giản. Nhưng sau một thời gian phát triển, rule này tồn tại ở ba nơi khác nhau: trong `AppointmentController` khi user đặt qua web, trong `AppointmentService.bookAppointment()`, và trong một API endpoint khác dùng cho mobile app. Ba chỗ, ba lần implement — và chúng không giống nhau hoàn toàn.

Khi product thay đổi rule — "bệnh nhân VIP được đặt dù có appointment pending" — developer tìm và sửa hai trong ba chỗ. Chỗ thứ ba bị bỏ sót. Bug tồn tại ba tháng trước khi ai đó phát hiện.

Đây không phải câu chuyện về developer cẩu thả. Đây là kết quả tất yếu khi business logic đặt sai chỗ.

---

## Business logic là gì — và đâu là chỗ đúng của nó

Business logic là tập hợp các quy tắc mô tả *cách hệ thống hoạt động theo đúng nghiệp vụ*. Không phải "làm sao lưu vào database," không phải "trả về HTTP 200 hay 400" — mà là "theo quy tắc của bệnh viện này, điều kiện để đặt lịch là gì."

Chỗ đúng của nó là **domain layer** — một lớp code độc lập, không biết HTTP tồn tại, không biết JPA tồn tại, chỉ biết quy tắc nghiệp vụ.

Nghe abstract. Nhìn vào code sẽ rõ hơn:

```java
// ❌ Vấn đề: business rule nằm trong Controller
@RestController
public class AppointmentController {

    @PostMapping("/appointments")
    public ResponseEntity<AppointmentResponse> book(@RequestBody BookingRequest request) {
        // Business rule trực tiếp trong controller — sai hoàn toàn
        List<Appointment> existing = appointmentRepository
            .findByPatientIdAndStatus(request.getPatientId(), AppointmentStatus.CONFIRMED);
        if (!existing.isEmpty()) {
            return ResponseEntity.badRequest().body(...);
        }
        // ... tiếp tục booking
    }
}
```

```java
// ❌ Vấn đề: business rule nằm trong Service nhưng exposed dưới dạng utility
@Service
public class AppointmentService {

    public boolean canPatientBook(UUID patientId) {
        // Đây là một rule quan trọng — nhưng nó là một method public
        // bất kỳ ai cũng có thể gọi hoặc... bỏ qua không gọi
        return appointmentRepository
            .findByPatientIdAndStatus(patientId, AppointmentStatus.CONFIRMED)
            .isEmpty();
    }

    public AppointmentResponse bookAppointment(BookingRequest request) {
        // Developer mới join không biết cần gọi canPatientBook() trước
        // Code vẫn compile — nhưng rule bị bypass
        Appointment appointment = new Appointment(request);
        return mapper.toResponse(appointmentRepository.save(appointment));
    }
}
```

```java
// ✅ Tốt hơn: business rule nằm trong domain, không thể bypass
public class Appointment {

    // Factory method — không ai tạo Appointment mà không đi qua đây
    public static Appointment book(Patient patient, DoctorSchedule schedule) {
        // Rule được enforce tại thời điểm tạo object — không thể bypass
        if (patient.hasConfirmedPendingAppointment()) {
            throw new AppointmentConflictException(
                "Patient " + patient.getId() + " already has a confirmed appointment"
            );
        }
        if (!schedule.hasAvailableSlots()) {
            throw new SlotUnavailableException("No available slots for this schedule");
        }
        return new Appointment(patient, schedule, AppointmentStatus.PENDING);
    }

    // Constructor private — buộc mọi người đi qua factory method
    private Appointment(Patient patient, DoctorSchedule schedule, AppointmentStatus status) {
        this.patient = patient;
        this.schedule = schedule;
        this.status = status;
        this.createdAt = Instant.now();
    }
}
```

Sự khác biệt quan trọng: trong version cuối, bạn **không thể** tạo một `Appointment` vi phạm rule nghiệp vụ. Không phải "cần nhớ gọi validate trước" — mà là rule được encode vào chính cấu trúc của object. Compiler là tuyến phòng thủ đầu tiên.

---

## Hai dấu hiệu business logic đang đặt sai chỗ

**Dấu hiệu 1: "Nhớ gọi X trước khi làm Y"**

Bất cứ khi nào trong team có câu "nhớ gọi `validatePatient()` trước khi gọi `bookAppointment()`" — đó là dấu hiệu rule nghiệp vụ đang nằm sai chỗ. Knowledge về quy trình đúng đang tồn tại trong đầu developer, không phải trong code. Khi developer mới join, họ không biết điều này — và sẽ viết code bypass rule mà không hay.

**Dấu hiệu 2: Cùng một rule xuất hiện ở nhiều nơi**

Nếu bạn grep codebase và tìm thấy cùng một điều kiện check xuất hiện ở ba file khác nhau — đó là business logic đang bị duplicate. Mỗi lần rule thay đổi, bạn phải nhớ update tất cả các chỗ. Sớm muộn cũng có chỗ bị bỏ sót.

---

## Hệ thống trả giá như thế nào

Khi business logic nằm sai chỗ, cái giá không đến ngay lập tức — nó tích lũy:

Năm đầu: team vẫn nhớ quy ước, mọi thứ ổn. Năm hai: team rotates, người mới không biết convention. Năm ba: có feature mới dùng một entry point khác, developer không biết cần enforce rule gì, implement thiếu. Bug production xuất hiện — và lúc đó việc tìm ra "rule này nên nằm ở đâu" trở thành một cuộc investigation mất vài ngày.

---

## Takeaway

Mỗi khi bạn viết một validation hay một business rule, hỏi: *"Rule này có thể bị bypass không — bằng cách gọi sai thứ tự, hoặc gọi từ một entry point khác?"* Nếu có — rule đó đang ở sai chỗ.

---

*Bài tiếp theo: Sai boundary một ly, hệ thống đi một dặm*
