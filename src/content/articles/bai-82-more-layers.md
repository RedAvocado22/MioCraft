---
title: "More layers không phải lúc nào cũng là design tốt hơn"
description: "Mỗi layer thêm vào là một indirection, một điểm failure, và một thứ cần maintain. Layer nên tồn tại vì nó giải quyết vấn đề thật — không phải vì pattern nói phải có."
category: system-design
pubDate: 2024-03-23
series: "Phần 9: Không phải lúc nào cũng đúng"
tags: ["tech-myths", "architecture", "layered-architecture"]
---

Có một giai đoạn trong quá trình học về architecture mà bạn bắt đầu thấy layers ở khắp nơi. Controller layer. Service layer. Repository layer. Mapper layer. Validation layer. DTO layer. Và sau khi đọc thêm về Clean Architecture: Use Case layer, Domain layer, Application layer, Infrastructure layer.

Nhiều layer hơn có vẻ như = design nghiêm túc hơn = code tốt hơn. Đây là một trong những misconception phổ biến nhất — và có hại nhất.

---

## Layer tồn tại để giải quyết vấn đề cụ thể

Mỗi layer trong một well-designed system tồn tại vì một lý do cụ thể, không phải vì "có nhiều layer là tốt."

**Controller layer** — tách HTTP concern ra khỏi business logic. Controller biết HTTP request, service không cần biết HTTP tồn tại.

**Service layer** — chứa business logic, orchestrate operations, quản lý transaction boundary.

**Repository layer** — tách database concern ra khỏi business logic. Service không cần biết bạn đang dùng JPA hay JDBC hay gì khác.

Ba layer đó giải quyết ba separation of concern thật sự. Đó là lý do layered architecture kinh điển vẫn đúng cho hầu hết project.

---

## Khi layer trở thành pass-through

Vấn đề bắt đầu khi bạn thêm layer vì "nên có" thay vì vì "cần thiết." Kết quả là pass-through layer — một layer không làm gì ngoài delegate sang layer tiếp theo.

```java
// ❌ ValidationService không làm gì ngoài gọi validator
@Service
public class AppointmentValidationService {
    private final AppointmentValidator validator;
    
    public void validate(BookingRequest request) {
        validator.validate(request); // Đây có thực sự cần một class riêng không?
    }
}

// ❌ AppointmentFacade không có logic gì
@Service
public class AppointmentFacade {
    private final AppointmentService service;
    
    public AppointmentResponse book(BookingRequest request) {
        return service.bookAppointment(request); // Pass-through hoàn toàn
    }
}
```

Hai class đó không giải quyết vấn đề gì. Chúng tạo ra thêm file để đọc, thêm indirection khi debug, và thêm chỗ để bug ẩn. Developer mới join team sẽ mất 10 phút để trace xem `AppointmentFacade` thực ra làm gì — chỉ để phát hiện ra nó không làm gì.

---

## Layer hợp lý vs. layer trang trí

Trong HMS, đây là một ví dụ của layer thêm vào có lý do thật:

```java
// ✅ AppointmentScheduler không phải pass-through — nó có responsibility riêng
@Component
public class AppointmentReminderScheduler {
    private final AppointmentRepository appointmentRepository;
    private final NotificationService notificationService;
    
    @Scheduled(cron = "0 8 * * *")
    public void sendDailyReminders() {
        // Scheduler layer responsibility: trigger, coordinate, không chứa business logic
        LocalDate tomorrow = LocalDate.now().plusDays(1);
        appointmentRepository.findConfirmedAppointmentsByDate(tomorrow)
            .forEach(notificationService::sendReminder);
    }
}
```

`AppointmentReminderScheduler` không phải layer vì triết lý. Nó tồn tại vì scheduling concern cần tách khỏi business logic — `AppointmentService` không nên biết nó được trigger bởi cron job hay HTTP call hay gì khác.

---

## Cách nhận ra bạn đang over-layering

Bạn trace một feature từ controller đến database và đi qua 7 class, nhưng chỉ 2-3 trong số đó thực sự có logic.

Bạn viết unit test cho một service và phải mock 4 dependency — nhưng service đó chỉ làm 2 thứ thực sự.

Bạn không thể giải thích tại sao một class tồn tại tách biệt với class kia ngoài câu "để clean architecture."

Những dấu hiệu đó không có nghĩa bạn sai hoàn toàn. Chúng có nghĩa là đã đến lúc ngồi lại và hỏi: *"Class này làm gì mà không thể sống trong class kia?"*

---

## Nguyên tắc thực tế

Thêm layer khi một layer hiện tại đang phải biết quá nhiều thứ cùng lúc — khi `AppointmentService` vừa handle HTTP parsing, vừa làm business logic, vừa format response, thì splitting có lý. Nhưng split để split là thêm complexity không có return.

Một codebase đơn giản với 3 layer rõ ràng luôn maintainable hơn một codebase 8 layer mà 5 layer là pass-through.

---

## Takeaway

Trước khi thêm bất kỳ layer nào, đặt câu hỏi: *"Layer này giải quyết vấn đề separation of concern nào cụ thể? Nếu không có nó thì class nào sẽ phải làm nhiều việc quá không?"* Nếu không trả lời được — layer đó chưa cần.

---

*Bài tiếp theo: Phần 10 — Real-world Case Studies từ HMS*
