---
title: "Design Pattern không giúp mày viết code tốt hơn — nếu mày dùng nó sai"
description: "Pattern là giải pháp cho vấn đề đã biết — không phải template để áp vào mọi nơi. Dùng pattern không có vấn đề để giải quyết là over-engineering."
category: programming
pubDate: 2024-02-09
series: "Phần 5: Design Patterns"
tags: ["design-patterns", "mindset", "over-engineering"]
---

Có một giai đoạn trong sự nghiệp của nhiều developer — thường là sau khi đọc xong cuốn Design Patterns của Gang of Four — mà họ bắt đầu nhìn thấy pattern ở khắp nơi.

Factory ở đây. Singleton ở kia. Cái service kia rõ ràng cần một Observer. Cái repo này trông như một Repository pattern. Họ bắt đầu wrap mọi thứ vào các lớp abstraction, tạo interface cho mọi class, và cảm thấy rằng mình đang viết code "xịn."

Rồi teammate ngồi vào đọc code và hỏi: *"Tại sao cái này cần phức tạp vậy?"*

---

## Pattern là ngôn ngữ, không phải mục tiêu

Trước khi đi vào từng pattern cụ thể, cần hiểu một điều: Design Pattern không phải là thứ mày "apply vào code." Chúng là **ngôn ngữ chung** để mô tả các giải pháp đã được kiểm chứng cho các vấn đề thường gặp.

Khi một senior nói "cái này nên dùng Strategy," họ không nói "đây là template mày cần copy vào." Họ đang nói: *"Vấn đề mày đang gặp có một cấu trúc quen thuộc, và đây là cách người ta đã giải quyết nó nhiều lần trước rồi."*

Sự khác biệt quan trọng này là thứ mà nhiều developer bỏ qua. Kết quả là họ dùng pattern như một checklist — *"mình đã dùng 5 pattern rồi, code chắc tốt lắm"* — thay vì dùng nó như một công cụ tư duy.

---

## Pattern có cái giá của nó

Mỗi pattern đều đánh đổi complexity để đổi lấy flexibility. Đó là deal bắt buộc, không có ngoại lệ.

Ví dụ trong HMS: giả sử mày muốn gửi notification khi một appointment được confirm. Cách đơn giản nhất:

```java
// ❌ Vấn đề: không phải vì sai, mà vì không cần thiết ở quy mô này
public void confirmAppointment(UUID appointmentId) {
    Appointment appointment = appointmentRepository.findById(appointmentId)
        .orElseThrow(() -> new AppointmentNotFoundException(appointmentId));
    
    appointment.confirm();
    appointmentRepository.save(appointment);
    
    // Gửi thẳng — đơn giản, rõ ràng, dễ đọc
    notificationService.sendAppointmentConfirmed(appointment);
}
```

Cách dùng Observer pattern:

```java
// ✅ Tốt hơn — khi số lượng subscriber thực sự tăng lên và cần decoupling
public void confirmAppointment(UUID appointmentId) {
    Appointment appointment = appointmentRepository.findById(appointmentId)
        .orElseThrow(() -> new AppointmentNotFoundException(appointmentId));
    
    appointment.confirm();
    appointmentRepository.save(appointment);
    
    // Event được publish, ai quan tâm thì tự subscribe
    eventPublisher.publishEvent(new AppointmentConfirmedEvent(appointment));
}
```

Version 2 tốt hơn không? **Phụ thuộc.**

Nếu chỉ có một subscriber (NotificationService) và không có kế hoạch thêm — version 1 rõ ràng hơn, dễ debug hơn, dễ trace flow hơn. Version 2 giấu dependency đi, làm cho người đọc code phải tìm xem ai đang lắng nghe event đó.

Nếu có 4-5 subscriber (notification, audit log, insurance processing, scheduling) và chúng cần chạy độc lập — version 2 mới thực sự mua lại được cái giá complexity đã bỏ ra.

---

## Dấu hiệu mày đang dùng pattern sai

**Pattern là giải pháp trước khi có vấn đề.** Nếu mày bắt đầu bằng "mình sẽ dùng Strategy pattern cho cái này" thay vì "cái này đang có vấn đề gì" — đó là dấu hiệu đầu tiên.

**Pattern làm code khó đọc hơn, không dễ hơn.** Một Pattern được dùng đúng chỗ làm code dễ hiểu vì nó map với một mental model quen thuộc. Một pattern sai chỗ tạo ra một đống abstraction không cần thiết mà người đọc phải navigate qua.

**Mày không thể giải thích tại sao cần pattern đó.** Nếu ai hỏi "tại sao đây là Strategy chứ không phải if-else?" mà mày không trả lời được bằng một tình huống cụ thể — thì pattern đó đang là decoration, không phải solution.

---

## Cách đúng để tiếp cận

Viết code đơn giản nhất trước. Khi mày gặp một trong các dấu hiệu sau, **lúc đó** mới nghĩ đến pattern:

- Cùng một đoạn logic bắt đầu xuất hiện ở nhiều chỗ
- Thêm một case mới yêu cầu sửa code cũ ở nhiều nơi
- Dependency giữa các module bắt đầu tạo ra vòng lặp
- Testing một class yêu cầu setup cả một đống thứ khác

Pattern tốt nhất là pattern mày refactor vào — không phải pattern mày viết từ đầu.

---

## Takeaway

Lần tới trước khi mày apply một pattern, hỏi: *"Vấn đề cụ thể nào pattern này đang giải quyết trong code mình đang viết?"* Nếu câu trả lời là "để code trông chuyên nghiệp hơn" — bỏ pattern đi, viết thẳng.

---

*Bài tiếp theo: Template Method — pattern mày đang dùng hàng ngày mà không biết tên*
