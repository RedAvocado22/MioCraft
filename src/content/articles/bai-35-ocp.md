---
title: "OCP — mỗi lần thêm feature lại sửa code cũ là thiết kế đang sai"
description: "Open/Closed Principle: mở để mở rộng, đóng để sửa đổi. Khi thêm feature mới mà phải sửa code đang chạy tốt — đó là dấu hiệu cần abstraction."
category: programming
pubDate: 2024-02-04
series: "Phần 4: SOLID"
tags: ["SOLID", "OCP", "OOP"]
---

Sprint 1, HMS có hai hình thức thanh toán: tiền mặt và chuyển khoản. Bạn code xong, chạy ngon, merge.

Sprint 5, thêm thanh toán qua VNPay. Bạn mở `PaymentService` ra, tìm đúng chỗ, thêm một `else if`. Xong.

Sprint 9, thêm Momo. Thêm một `else if` nữa. Vẫn okay.

Sprint 13, thêm ZaloPay. Lần này bạn bắt đầu thấy khó chịu — cái method `processPayment()` đang dài ra, điều kiện lồng nhau, mỗi lần thêm loại mới lại phải đọc lại toàn bộ để tìm chỗ sửa đúng. Và bạn hiểu ra: mình đang làm cái này sai từ đầu.

Đây chính là vấn đề mà **Open/Closed Principle** được sinh ra để giải quyết.

---

## Open/Closed Principle là gì

Nguyên tắc này được Bertrand Meyer phát biểu: *"Software entities should be open for extension, but closed for modification."*

Dịch ra: khi bạn cần thêm tính năng mới, bạn nên **thêm code mới** — không phải **sửa code cũ đã hoạt động**.

Lý do rất thực tế: code cũ đã được test, đã chạy ổn định trên production, đã được validate. Mỗi lần bạn mở nó ra và sửa, bạn đang đặt cược rằng mình sẽ không break gì — dù codebase ngày càng phức tạp, dù người viết code gốc có thể không còn ở đó để giải thích.

---

## Ví dụ — vấn đề với if-else chain

Đây là code điển hình vi phạm OCP:

```java
// ❌ Vấn đề — mỗi lần thêm payment method, phải sửa class này
@Service
public class PaymentService {

    public PaymentResult processPayment(PaymentRequest request) {
        if (request.getMethod() == PaymentMethod.CASH) {
            // xử lý tiền mặt
            return processCash(request);

        } else if (request.getMethod() == PaymentMethod.BANK_TRANSFER) {
            // xử lý chuyển khoản
            BankTransferClient client = new BankTransferClient(bankConfig);
            return client.transfer(request.getAmount(), request.getBankAccount());

        } else if (request.getMethod() == PaymentMethod.VNPAY) {
            // xử lý VNPay
            VNPayClient vnpay = new VNPayClient(vnpayConfig);
            String redirectUrl = vnpay.createPaymentUrl(request);
            return PaymentResult.pending(redirectUrl);

        } else if (request.getMethod() == PaymentMethod.MOMO) {
            // xử lý Momo
            MomoClient momo = new MomoClient(momoConfig);
            return momo.requestPayment(request);

        } else {
            throw new UnsupportedOperationException("Unknown payment method: " + request.getMethod());
        }
    }
}
```

Thêm ZaloPay: bạn phải mở file này ra, đọc lại toàn bộ, thêm một `else if` ở dưới cùng, và hy vọng bạn không vô tình làm vỡ logic của bốn method ở trên.

Tệ hơn: nếu sau này bạn cần viết unit test riêng cho từng payment method — bạn sẽ không làm được sạch sẽ, vì chúng đang bị tổng hợp trong cùng một method.

---

## Thiết kế lại theo OCP

Giải pháp là tách logic từng payment method ra thành các implementation riêng, đằng sau một interface chung:

```java
// ✅ Tốt hơn — interface đóng vai trò contract
public interface PaymentProcessor {
    boolean supports(PaymentMethod method);
    PaymentResult process(PaymentRequest request);
}

// Mỗi loại payment là một implementation riêng
@Component
public class CashPaymentProcessor implements PaymentProcessor {

    @Override
    public boolean supports(PaymentMethod method) {
        return method == PaymentMethod.CASH;
    }

    @Override
    public PaymentResult process(PaymentRequest request) {
        // logic tiền mặt ở đây
        return PaymentResult.success(request.getAmount());
    }
}

@Component
public class VNPayProcessor implements PaymentProcessor {

    private final VNPayClient vnpayClient;

    @Override
    public boolean supports(PaymentMethod method) {
        return method == PaymentMethod.VNPAY;
    }

    @Override
    public PaymentResult process(PaymentRequest request) {
        String redirectUrl = vnpayClient.createPaymentUrl(request);
        return PaymentResult.pending(redirectUrl);
    }
}

// PaymentService không còn biết gì về implementation
@Service
public class PaymentService {

    private final List<PaymentProcessor> processors;

    public PaymentService(List<PaymentProcessor> processors) {
        this.processors = processors;
    }

    public PaymentResult processPayment(PaymentRequest request) {
        return processors.stream()
            .filter(p -> p.supports(request.getMethod()))
            .findFirst()
            .orElseThrow(() -> new UnsupportedPaymentMethodException(request.getMethod()))
            .process(request);
    }
}
```

Bây giờ thêm ZaloPay: bạn chỉ cần tạo một class `ZaloPayProcessor implements PaymentProcessor`. Không đụng đến `PaymentService`. Không đụng đến ba processor kia. Spring tự inject class mới vào danh sách, `PaymentService` tự nhận ra.

**Code cũ đóng với modification. Logic mới mở với extension.**

---

## OCP trong Spring Boot — bạn đang dùng nó mà không hay

Đây là điều thú vị: Spring Boot được thiết kế để OCP trở nên tự nhiên.

`List<PaymentProcessor> processors` trong constructor ở trên — Spring sẽ tự inject tất cả beans implements `PaymentProcessor` vào đó. Bạn không cần đăng ký thêm ở đâu cả. Tạo class mới có `@Component` và implement đúng interface — nó tự được nhặt lên.

Đây là ví dụ khác từ HMS — hệ thống notification với nhiều kênh:

```java
// Interface chung cho tất cả notification channels
public interface NotificationChannel {
    boolean supports(NotificationType type);
    void send(NotificationPayload payload);
}

@Component
public class EmailNotificationChannel implements NotificationChannel {
    @Override
    public boolean supports(NotificationType type) {
        return type == NotificationType.EMAIL || type == NotificationType.ALL;
    }

    @Override
    public void send(NotificationPayload payload) {
        emailService.send(payload.getRecipient(), payload.getSubject(), payload.getBody());
    }
}

@Component  
public class SmsNotificationChannel implements NotificationChannel {
    @Override
    public boolean supports(NotificationType type) {
        return type == NotificationType.SMS || type == NotificationType.ALL;
    }

    @Override
    public void send(NotificationPayload payload) {
        smsService.send(payload.getPhone(), payload.getBody());
    }
}

// Notification service không care có bao nhiêu kênh
@Service
public class NotificationService {

    private final List<NotificationChannel> channels;

    public void notify(NotificationPayload payload) {
        channels.stream()
            .filter(c -> c.supports(payload.getType()))
            .forEach(c -> c.send(payload));
    }
}
```

PM muốn thêm push notification? Tạo `PushNotificationChannel implements NotificationChannel`. Xong. `NotificationService` không cần biết.

---

## Khi nào thì áp dụng OCP

OCP không có nghĩa là bạn cần tạo interface cho mọi thứ từ đầu. Đó là over-engineering.

Câu hỏi cần hỏi là: *"Cái này có khả năng thay đổi theo nhiều hướng khác nhau không?"* Payment methods — có. Notification channels — có. Một hàm tính tuổi từ ngày sinh — không cần.

Dấu hiệu bạn cần OCP là khi bạn bắt đầu nhận ra mình đang thêm vào một danh sách `if/else if` hoặc `switch/case` ngày càng dài. Lúc đó dừng lại và hỏi: *"Những branch này có thể được encapsulate thành các objects riêng không?"* Nếu có — refactor theo OCP trước khi danh sách đó dài thêm một nhánh nữa.

---

## Takeaway

Lần tới khi bạn chuẩn bị thêm một `else if` vào một switch-case đã có sẵn, dừng lại. Hỏi: *"Mình có thể thêm tính năng này mà không sửa code đang chạy không?"* Nếu câu trả lời là có — refactor trước, thêm sau. Nếu bạn không refactor lần này, lần tới sẽ đau hơn.

---

*Bài tiếp theo: LSP — kế thừa sai còn nguy hiểm hơn code xấu*
