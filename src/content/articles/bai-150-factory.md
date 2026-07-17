---
title: "Factory — khi bạn không muốn code biết nó đang tạo ra object gì"
description: "GoF gặp vấn đề với `new` keyword — nó buộc code phải biết cụ thể class nào sẽ được tạo. Factory cắt đứt sự phụ thuộc đó. Abstract Factory đi thêm một bước."
category: programming
pubDate: 2026-07-05
series: "Phần 5: Design Patterns"
tags: ["factory", "abstract-factory", "design-pattern", "spring"]
---

Có một cái keyword trong Java mà GoF không thích — `new`.

Không phải vì `new` xấu. Mà vì mỗi lần bạn viết `new SomeConcreteClass()`, bạn đang tạo ra một sự phụ thuộc cứng vào đúng cái class đó. Code của bạn đang nói: *“Mình biết chính xác loại object mình cần, và mình muốn loại này chứ không phải loại khác.”*

Đôi khi điều đó ổn. Đôi khi đó là vấn đề.

---

## Pain point: code phải biết quá nhiều

HMS có notification system. Tuỳ vào loại event, hệ thống gửi SMS, email, hoặc push notification. Code ban đầu:

```java
// ❌ Caller phải biết tất cả implementation
public void sendNotification(String type, String recipient, String content) {
    if (type.equals("SMS")) {
        var sender = new SmsSender(smsApiKey, smsGatewayUrl);
        sender.send(recipient, content);
    } else if (type.equals("EMAIL")) {
        var sender = new EmailSender(smtpHost, smtpPort, smtpUser);
        sender.send(recipient, content);
    } else if (type.equals("PUSH")) {
        var sender = new PushNotificationSender(fcmKey);
        sender.send(recipient, content);
    }
}
```

Mỗi lần có loại notification mới, bạn vào sửa method này. Mỗi lần config của `SmsSender` thay đổi, bạn vào sửa chỗ này. `sendNotification` đang biết quá nhiều thứ không phải việc của nó.

---

## Factory Method: tách quyết định “tạo gì” ra khỏi “dùng gì”

GoF giải bài này bằng cách đưa logic tạo object vào một method riêng — hoặc một class riêng:

```java
// Interface chung
public interface NotificationSender {
    void send(String recipient, String content);
}

// Các implementation
public class SmsSender implements NotificationSender { /* ... */ }
public class EmailSender implements NotificationSender { /* ... */ }
public class PushNotificationSender implements NotificationSender { /* ... */ }

// Factory — biết cách tạo
public class NotificationSenderFactory {
    public static NotificationSender create(String type) {
        return switch (type) {
            case "SMS"   -> new SmsSender(smsApiKey, smsGatewayUrl);
            case "EMAIL" -> new EmailSender(smtpHost, smtpPort, smtpUser);
            case "PUSH"  -> new PushNotificationSender(fcmKey);
            default      -> throw new IllegalArgumentException("Unknown type: " + type);
        };
    }
}

// Caller: không biết gì về implementation
public void sendNotification(String type, String recipient, String content) {
    NotificationSender sender = NotificationSenderFactory.create(type);
    sender.send(recipient, content);
}
```

Logic tạo object bây giờ tập trung một chỗ. `sendNotification` chỉ cần biết `NotificationSender` interface — không cần biết `SmsSender` tồn tại.

---

## Abstract Factory: khi bạn cần một *bộ* object nhất quán

Factory Method giải bài “tạo một object”. Abstract Factory giải bài khác hơn một chút: “tạo một *bộ* các object liên quan, đảm bảo chúng không bị trộn lẫn với nhau.”

HMS chạy hai môi trường: production và test. Production dùng VNPay thật, SMS gateway thật, S3 thật. Test dùng mock của cả ba. Vấn đề không phải là tạo từng cái — Factory Method làm được rồi. Vấn đề là đảm bảo không ai vô tình mix: VNPay thật với mock SMS. Nếu điều đó xảy ra, test chạy thật tiền, hoặc production gửi SMS vào void.

Abstract Factory giải bài này bằng cách gom tất cả factory method của một “bộ” vào chung một interface. Bạn chỉ có thể dùng toàn production hoặc toàn mock — không có trạng thái ở giữa:

```java
// Abstract Factory — một interface, gom tất cả factory method của cùng một "bộ"
public interface HmsServiceFactory {
    PaymentGateway createPaymentGateway();
    NotificationSender createNotificationSender();
    StorageService createStorageService();
}
```

Hai implementation — một bộ thật, một bộ mock. Không bao giờ trộn:

```java
// Production: tất cả thật
public class ProductionServiceFactory implements HmsServiceFactory {
    @Override
    public PaymentGateway createPaymentGateway() {
        return new VnpayGateway(vnpayConfig);
    }

    @Override
    public NotificationSender createNotificationSender() {
        return new SmsSender(smsConfig);
    }

    @Override
    public StorageService createStorageService() {
        return new S3StorageService(s3Config);
    }
}

// Test: tất cả mock — đổi factory là đổi cả bộ, không sửa gì khác
public class TestServiceFactory implements HmsServiceFactory {
    @Override
    public PaymentGateway createPaymentGateway() {
        return new MockPaymentGateway();
    }

    @Override
    public NotificationSender createNotificationSender() {
        return new MockNotificationSender();
    }

    @Override
    public StorageService createStorageService() {
        return new InMemoryStorageService();
    }
}
```

Business code nhận `HmsServiceFactory` — không biết đang chạy bộ nào. Muốn switch environment? Đổi implementation của factory ở một chỗ duy nhất, toàn bộ hệ thống theo.

---

## Spring đã có phiên bản mình của Factory

Trong Spring Boot, bạn hiếm khi cần viết factory tay. Spring có `@ConditionalOnProperty`, `@Profile`, và `@Bean` method — tất cả đều là factory mechanism ở tầng framework:

```java
// ✅ Spring-style factory — dùng @Profile thay vì class factory
@Configuration
public class NotificationConfig {

    @Bean
    @Profile("production")
    public NotificationSender productionSender(SmsConfig config) {
        return new SmsSender(config);
    }

    @Bean
    @Profile("test")
    public NotificationSender testSender() {
        return new MockNotificationSender();
    }
}
```

Spring quyết định bean nào được tạo dựa trên active profile. Code inject `NotificationSender` không biết và không cần biết đang ở môi trường nào.

---

## Khi nào viết factory tay vẫn hợp lý

Factory thủ công vẫn có chỗ trong Spring ecosystem — khi quyết định tạo object xảy ra **runtime**, không phải **startup time**.

Ví dụ: HMS có export feature, bạn không biết trước user muốn export PDF hay Excel cho đến khi họ click. Spring không inject bean theo request runtime — đó là việc của factory:

```java
@Component
@RequiredArgsConstructor
public class ReportExporterFactory {

    private final PdfReportExporter pdfExporter;
    private final ExcelReportExporter excelExporter;

    public ReportExporter create(ExportFormat format) {
        return switch (format) {
            case PDF   -> pdfExporter;
            case EXCEL -> excelExporter;
        };
    }
}
```

`PdfReportExporter` và `ExcelReportExporter` vẫn là Spring bean, được inject vào factory. Factory chỉ làm routing — không tự `new` ra gì cả. Đây là cách sạch nhất để kết hợp Spring DI với runtime selection.

---

## Khi nào không dùng Factory

Factory thêm abstraction layer. Abstraction layer có giá — code dài hơn, flow khó trace hơn. Đừng dùng factory khi:

Bạn chỉ có một implementation và không có kế hoạch thêm. Tạo interface + factory cho `EmailSender` khi hệ thống chỉ bao giờ dùng email là over-engineering (bài 04 đã nói về cái bẫy này).

Logic tạo object đơn giản đến mức ai đọc cũng hiểu ngay. Factory che giấu thông tin — hữu ích khi thông tin đó phức tạp, gây nhiễu khi đơn giản.

---

## Takeaway

Factory giải một bài cụ thể: *code không nên biết chính xác class nào đang được tạo*. Khi bạn có một điểm trong code mà việc thêm implementation mới đòi hỏi sửa caller, đó là dấu hiệu cần factory. Khi bạn chỉ có một implementation và Spring đã quản lý lifecycle cho bạn, factory là giấy bọc không cần thiết.

---

*Bài tiếp theo: Builder — object phức tạp không cần constructor 12 tham số*
