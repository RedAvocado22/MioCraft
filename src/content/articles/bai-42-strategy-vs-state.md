---
title: "Strategy vs State — hành vi hay trạng thái đang thay đổi?"
description: "Strategy và State trông giống nhau về cấu trúc nhưng giải quyết vấn đề khác nhau. Hiểu sai là dùng sai — và code sẽ không express đúng intent."
category: programming
pubDate: 2024-02-11
series: "Phần 5: Design Patterns"
tags: ["design-patterns", "strategy", "state"]
---

Hai pattern này trông giống nhau đến mức nhiều người dùng nhầm cả đời mà không biết. Cả hai đều có một interface, nhiều implementation, và một object nào đó giữ reference đến implementation đó. Structure diagram gần như y chang nhau.

Sự khác biệt không nằm ở code. Nó nằm ở **ý định**.

---

## Strategy: hành vi được chọn từ bên ngoài

Strategy giải quyết bài toán: *"Cùng một hành động, nhưng cách thực hiện khác nhau tùy theo context."*

Điểm mấu chốt: **caller quyết định strategy nào được dùng.** Object không tự thay đổi strategy của mình — nó nhận strategy từ ngoài vào, và thực thi theo đó.

Trong HMS, payment là ví dụ điển hình. Một appointment có thể được thanh toán bằng tiền mặt, thẻ ngân hàng, hay bảo hiểm. Logic tính toán và xử lý khác nhau hoàn toàn — nhưng từ góc độ `PaymentService`, việc cần làm là như nhau: xử lý một payment.

```java
// Strategy interface
public interface PaymentStrategy {
    PaymentResult process(PaymentRequest request);
    boolean supports(PaymentMethod method);
}

// Implementation 1
@Component
public class CashPaymentStrategy implements PaymentStrategy {
    
    @Override
    public PaymentResult process(PaymentRequest request) {
        // Ghi nhận thanh toán tiền mặt, không cần call external API
        CashReceipt receipt = receiptGenerator.generate(request);
        return PaymentResult.success(receipt.getReceiptNumber());
    }
    
    @Override
    public boolean supports(PaymentMethod method) {
        return method == PaymentMethod.CASH;
    }
}

// Implementation 2
@Component
public class InsurancePaymentStrategy implements PaymentStrategy {
    
    @Override
    public PaymentResult process(PaymentRequest request) {
        // Gửi claim lên hệ thống bảo hiểm, chờ approval
        InsuranceClaim claim = insuranceGateway.submitClaim(request);
        return claim.isApproved() 
            ? PaymentResult.success(claim.getClaimId())
            : PaymentResult.pending(claim.getClaimId());
    }
    
    @Override
    public boolean supports(PaymentMethod method) {
        return method == PaymentMethod.INSURANCE;
    }
}

// Service dùng Strategy — không biết và không cần biết implementation cụ thể
@Service
public class PaymentService {
    
    private final List<PaymentStrategy> strategies;
    
    public PaymentResult processPayment(PaymentRequest request) {
        PaymentStrategy strategy = strategies.stream()
            .filter(s -> s.supports(request.getPaymentMethod()))
            .findFirst()
            .orElseThrow(() -> new UnsupportedPaymentMethodException(request.getPaymentMethod()));
        
        return strategy.process(request);
    }
}
```

Strategy được chọn dựa trên `request.getPaymentMethod()` — đến từ bên ngoài. `PaymentService` không tự quyết định, không tự chuyển đổi strategy trong quá trình xử lý.

---

## State: hành vi thay đổi theo trạng thái nội tại

State giải quyết bài toán hoàn toàn khác: *"Cùng một object, nhưng hành vi khác nhau tùy theo trạng thái hiện tại của nó."*

Điểm mấu chốt: **object tự chuyển đổi state của mình** khi có sự kiện xảy ra. Caller không cần biết object đang ở state nào — nó chỉ gọi method, object tự xử lý.

`Appointment` trong HMS có nhiều trạng thái: `PENDING`, `CONFIRMED`, `IN_PROGRESS`, `COMPLETED`, `CANCELLED`. Hành vi của nó với cùng một thao tác — ví dụ `cancel()` — khác nhau tùy trạng thái:

```java
public interface AppointmentState {
    void confirm(AppointmentContext ctx);
    void cancel(AppointmentContext ctx);
    void complete(AppointmentContext ctx);
    AppointmentStatus getStatus();
}

public class PendingState implements AppointmentState {
    
    @Override
    public void confirm(AppointmentContext ctx) {
        // PENDING -> CONFIRMED: hợp lệ, chuyển state và gửi notification
        ctx.setState(new ConfirmedState());
        ctx.publishEvent(new AppointmentConfirmedEvent(ctx.getAppointmentId()));
    }
    
    @Override
    public void cancel(AppointmentContext ctx) {
        // PENDING -> CANCELLED: hợp lệ, hoàn tiền đặt cọc nếu có
        ctx.setState(new CancelledState());
        ctx.publishEvent(new AppointmentCancelledEvent(ctx.getAppointmentId()));
    }
    
    @Override
    public void complete(AppointmentContext ctx) {
        // Không thể complete khi chưa confirm
        throw new InvalidStateTransitionException("Cannot complete a PENDING appointment");
    }
    
    @Override
    public AppointmentStatus getStatus() { return AppointmentStatus.PENDING; }
}

public class CompletedState implements AppointmentState {
    
    @Override
    public void confirm(AppointmentContext ctx) {
        throw new InvalidStateTransitionException("Appointment already completed");
    }
    
    @Override
    public void cancel(AppointmentContext ctx) {
        // Không thể cancel sau khi đã khám xong
        throw new InvalidStateTransitionException("Cannot cancel a completed appointment");
    }
    
    @Override
    public void complete(AppointmentContext ctx) {
        throw new InvalidStateTransitionException("Appointment already completed");
    }
    
    @Override
    public AppointmentStatus getStatus() { return AppointmentStatus.COMPLETED; }
}
```

Caller chỉ cần gọi:
```java
appointment.cancel(); // Object tự biết mình đang ở state nào, xử lý đúng theo đó
```

Không có if-else kiểu `if (status == PENDING) { ... } else if (status == CONFIRMED) { ... }` nằm trong service. Logic đó được đặt đúng chỗ — trong chính object đang có state đó.

---

## Câu hỏi để phân biệt

Khi bạn đang design và không chắc nên dùng cái nào, hỏi:

**"Ai quyết định behavior nào được dùng?"**

- Nếu **caller bên ngoài** quyết định → Strategy
- Nếu **chính object** tự quyết định dựa trên state nội tại → State

**"Behavior có thể thay đổi trong vòng đời của một object không?"**

- Không thay đổi (chọn một lần, dùng xuyên suốt) → Strategy
- Thay đổi khi sự kiện xảy ra → State

---

## Sai lầm phổ biến

Dùng Strategy để implement State machine — viết một đống `if (currentStrategy instanceof XxxStrategy)` để kiểm tra trạng thái. Đây là dấu hiệu bạn đang dùng sai tool. Strategy không có khái niệm "transition" giữa các implementation. State thì có.

Và ngược lại — dùng State khi hành vi đơn giản chỉ cần được inject từ ngoài. Không phải mọi if-else đều cần trở thành State machine.

---

## Takeaway

Trong HMS, `Appointment` là ứng viên hoàn hảo cho State pattern vì nó có lifecycle rõ ràng và behavior thay đổi theo từng giai đoạn. `PaymentService` là ứng viên cho Strategy vì caller biết và chọn payment method. Nhìn lại code bạn — bạn có đang dùng if-else để kiểm tra trạng thái một object trước khi quyết định làm gì không? Đó là State pattern đang chờ được extract ra.

---

*Bài tiếp theo: Observer — tại sao notification không được gọi trong transaction*
