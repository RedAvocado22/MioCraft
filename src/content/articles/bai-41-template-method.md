---
title: "Template Method — pattern mày đang dùng hàng ngày mà không biết tên"
description: "Bất cứ khi nào bạn có một quy trình cố định nhưng các bước có thể thay đổi — Template Method đang ở đó. Abstract class trong Spring Boot là ví dụ điển hình."
category: programming
pubDate: 2024-02-10
series: "Phần 5: Design Patterns"
tags: ["design-patterns", "template-method", "OOP"]
---

Nếu mày đang dùng Spring Boot và có một `BaseService` với vài method abstract, hoặc một abstract class với một method `execute()` gọi vài step theo thứ tự cố định — mày đã dùng Template Method rồi. Chỉ là mày chưa gọi nó bằng tên.

Đây là pattern phổ biến nhất trong Java backend mà ít người để ý, vì nó ẩn trong cách Java hoạt động — inheritance, abstract method, override. Nhưng khi hiểu nó đúng, mày sẽ nhận ra tại sao một số codebase đọc rất dễ trong khi codebase khác cứ lặp đi lặp lại cùng một đoạn logic ở mười mấy chỗ.

---

## Vấn đề nó giải quyết

HMS có nhiều loại notification: khi appointment được confirm, khi lịch khám sắp tới, khi có kết quả xét nghiệm. Mỗi loại khác nhau về content, nhưng flow xử lý là giống nhau:

1. Lấy thông tin người nhận
2. Build nội dung message
3. Validate trước khi gửi
4. Gửi qua channel phù hợp (email, SMS, push)
5. Log kết quả

Nếu không có structure, mày sẽ viết 5 cái service, mỗi cái một đống if-else, và bước 1, 3, 5 bị copy-paste khắp nơi. Ba tháng sau có bug ở bước validate — mày sửa ở 3 chỗ, quên mất 2 chỗ, production báo lỗi lúc 2 giờ sáng.

Template Method giải quyết đúng vấn đề này.

---

## Cách nó hoạt động

Ý tưởng rất đơn giản: một class cha định nghĩa **skeleton của một algorithm** — các bước theo thứ tự cố định. Những bước nào thay đổi theo từng loại thì để trống (abstract), để class con tự implement.

```java
// Class cha định nghĩa skeleton
public abstract class NotificationSender {

    // Template method — đây là "công thức" cố định, không override
    public final void send(NotificationRequest request) {
        NotificationTarget target = resolveTarget(request);     // Bước 1: ai nhận
        String content = buildContent(request);                  // Bước 2: nội dung gì
        
        if (!validate(target, content)) {                        // Bước 3: có hợp lệ không
            log.warn("Notification validation failed for request: {}", request.getId());
            return;
        }
        
        deliver(target, content);                                 // Bước 4: gửi đi
        logResult(request, target);                               // Bước 5: ghi log
    }

    // Các bước KHÔNG thay đổi — implement ở đây
    private NotificationTarget resolveTarget(NotificationRequest request) {
        return targetResolver.resolve(request.getRecipientId());
    }

    private void logResult(NotificationRequest request, NotificationTarget target) {
        notificationLogRepository.save(NotificationLog.of(request, target));
    }

    // Các bước THAY ĐỔI theo từng loại — để class con implement
    protected abstract String buildContent(NotificationRequest request);
    protected abstract void deliver(NotificationTarget target, String content);

    // Bước có default nhưng class con có thể override nếu cần
    protected boolean validate(NotificationTarget target, String content) {
        return target != null && content != null && !content.isBlank();
    }
}
```

Class con chỉ cần điền vào phần thay đổi:

```java
// Notification khi appointment được confirm
public class AppointmentConfirmedSender extends NotificationSender {

    @Override
    protected String buildContent(NotificationRequest request) {
        Appointment appointment = appointmentRepository.findById(request.getReferenceId())
            .orElseThrow();
        return messageBuilder.buildConfirmationMessage(appointment);
    }

    @Override
    protected void deliver(NotificationTarget target, String content) {
        // Loại này gửi cả email lẫn SMS
        emailGateway.send(target.getEmail(), content);
        smsGateway.send(target.getPhone(), content);
    }
}

// Notification kết quả xét nghiệm — chỉ gửi trong app
public class LabResultSender extends NotificationSender {

    @Override
    protected String buildContent(NotificationRequest request) {
        LabResult result = labResultRepository.findById(request.getReferenceId())
            .orElseThrow();
        return messageBuilder.buildLabResultMessage(result);
    }

    @Override
    protected void deliver(NotificationTarget target, String content) {
        // Lab result nhạy cảm — chỉ push notification, không gửi SMS
        pushNotificationGateway.send(target.getDeviceToken(), content);
    }
    
    @Override
    protected boolean validate(NotificationTarget target, String content) {
        // Override: cần kiểm tra thêm device token có tồn tại không
        return super.validate(target, content) && target.getDeviceToken() != null;
    }
}
```

---

## Điều quan trọng nhất: `final`

Để ý keyword `final` trên method `send()`. Đây không phải chi tiết nhỏ.

`final` đảm bảo không ai — kể cả class con — có thể override method đó và phá vỡ thứ tự các bước. Nếu mày quên `final`, class con hoàn toàn có thể override `send()` và bỏ qua bước validate, bước log, hoặc bất kỳ thứ gì. Skeleton trở thành optional thay vì mandatory.

Trong Template Method, cái "template" là bất khả xâm phạm. Class con chỉ được phép điền vào chỗ trống đã được chỉ định.

---

## Khi nào dùng, khi nào không

**Dùng khi:** có nhiều variant của cùng một algorithm với phần lớn step giống nhau. Ví dụ: export report ra PDF/Excel/CSV có cùng bước validate permission, fetch data, format, trả file. Chỉ phần format là khác nhau.

**Không dùng khi:** các step thay đổi quá nhiều hoặc thứ tự step khác nhau giữa các variant. Lúc đó cần Strategy hoặc cấu trúc khác — ép vào Template Method sẽ tạo ra một cái abstract class cong queo với 80% method bị override.

**Cũng không dùng khi:** chỉ có một hoặc hai variant và không có kế hoạch thêm. Một abstract class cho hai implementation là over-engineering.

---

## Takeaway

Nhìn lại code HMS của mày — có class nào đang có logic lặp lại giữa nhiều service không? Nếu có, thử vẽ ra các bước, xác định bước nào cố định và bước nào thay đổi. Nếu pattern đó xuất hiện ít nhất 3 lần — đó là lúc Template Method đáng được refactor vào.

---

*Bài tiếp theo: Strategy vs State — hành vi hay trạng thái đang thay đổi?*
