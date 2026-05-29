---
title: "DRY không phải lúc nào cũng là best practice"
description: "Don't Repeat Yourself hướng dẫn về knowledge duplication — không phải code duplication. Đôi khi duplicate code là đúng. Wrong abstraction tệ hơn duplicate code."
category: system-design
pubDate: 2024-03-19
series: "Phần 9: Không phải lúc nào cũng đúng"
tags: ["tech-myths", "DRY", "abstraction"]
---

DRY — Don't Repeat Yourself — là một trong những nguyên tắc đầu tiên mày học về code quality. Và nó đúng. Nhưng như nhiều thứ khác trong lập trình, khi áp dụng không đúng chỗ, nó tạo ra vấn đề còn tệ hơn việc có code trùng lặp.

---

## Cái bẫy của DRY quá sớm

Hai đoạn code trông giống nhau không có nghĩa là chúng nên được merge thành một.

Trong HMS, `AppointmentService` và `ExaminationQueueService` đều có logic validate xem doctor có đang làm việc không. Code trông giống nhau:

```java
// AppointmentService
if (!doctor.isActive() || doctor.getStatus() != DoctorStatus.AVAILABLE) {
    throw new BusinessException("Doctor is not available");
}

// ExaminationQueueService  
if (!doctor.isActive() || doctor.getStatus() != DoctorStatus.AVAILABLE) {
    throw new BusinessException("Doctor is not available");
}
```

Phản xạ DRY sẽ bảo: extract ra một method `validateDoctorAvailability(Doctor doctor)` và dùng chung.

Nhưng hãy nghĩ xa hơn một chút. Sáu tháng sau, business rule thay đổi: khi book appointment, doctor có status `ON_LEAVE` vẫn có thể nhận booking cho ngày future. Nhưng khi add vào examination queue (real-time), doctor phải đang AVAILABLE ngay lúc đó.

Nếu hai chỗ đang share cùng một method, mày phải split chúng ra — hoặc thêm một parameter boolean `isFutureBooking` vào method đó, tạo ra một function làm hai việc khác nhau tùy context.

Code duplication ban đầu là **tình cờ trùng lặp** — cùng implementation nhưng khác conceptual meaning. Merge chúng sớm tạo ra **coupling nhân tạo** giữa hai domain không liên quan.

---

## Wrong abstraction tệ hơn duplication

Sandi Metz có một câu nổi tiếng: *"duplication is far cheaper than the wrong abstraction."*

Một abstract đúng làm code đơn giản hơn. Một abstract sai làm code phức tạp hơn và khó sửa hơn — vì bây giờ mày phải hiểu abstraction đó trước khi hiểu bài toán thật.

Trong HMS, `BaseService` pattern là ví dụ về abstraction đúng — nó capture thứ genuinely chung: CRUD operations, audit logging, user context. Nhưng nếu mày cố gắng merge `InsuranceClaimService` và `PaymentService` vì cả hai đều "xử lý tiền" — đó là wrong abstraction. Business rule của insurance claim và trực tiếp payment khác nhau đủ để chúng cần sống riêng.

---

## Rule of Three — một heuristic thực tế

Thay vì "đừng bao giờ lặp lại code", một heuristic thực tế hơn là: **lần đầu — viết thẳng. Lần thứ hai — ghi nhận. Lần thứ ba — refactor.**

Khi một logic xuất hiện lần thứ ba ở ba context khác nhau, đó là lúc có đủ evidence để nói rằng đây là genuinely shared logic, không phải tình cờ trùng lặp.

Một lần xuất hiện: viết thẳng vào trong context đó.
Hai lần: ghi nhận, chưa làm gì.
Ba lần: lúc này mới extract — và mày có đủ sample để biết abstraction nên trông như thế nào.

---

## Khi nào DRY thực sự quan trọng

DRY có giá trị cao nhất với **knowledge duplication**, không chỉ code duplication.

Ví dụ: business rule "một bệnh nhân chỉ được đặt tối đa 3 lịch trong một tuần" không được xuất hiện ở 3 chỗ khác nhau — trong `AppointmentService`, trong `AdminService`, và trong một query validation. Nếu rule này thay đổi, mày phải đổi ở 3 chỗ và guarantee không miss chỗ nào.

```java
// ✅ Business rule sống ở một chỗ duy nhất
public class AppointmentPolicy {
    public static final int MAX_APPOINTMENTS_PER_WEEK = 3;
    
    public void validateWeeklyLimit(UUID patientId, LocalDate week) {
        long count = appointmentRepository.countByPatientAndWeek(patientId, week);
        if (count >= MAX_APPOINTMENTS_PER_WEEK) {
            throw new BusinessException(
                "Patient has reached the weekly appointment limit of " + MAX_APPOINTMENTS_PER_WEEK
            );
        }
    }
}
```

Magic number `3` không được scatter khắp codebase. Logic validate không được duplicate. Đây là DRY đúng nghĩa — một source of truth cho một business rule.

---

## Takeaway

Lần tiếp theo mày thấy hai đoạn code giống nhau và muốn extract, dừng lại và hỏi: *"Chúng giống nhau vì cùng một lý do, hay chỉ tình cờ?"* Nếu không trả lời được câu đó — chờ thêm một lần nữa mới quyết định.

---

*Bài tiếp theo: Clean Architecture không phải lúc nào cũng tốt*
