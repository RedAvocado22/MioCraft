---
title: "Adapter — khi hai interface không nói chuyện được với nhau"
description: "GoF gặp vấn đề với code legacy và third-party library có interface không khớp. Adapter là cái adapter phích cắm của lập trình — không thay đổi gì ở hai đầu, chỉ làm cho chúng vừa nhau."
category: programming
pubDate: 2026-07-19
series: "Phần 5: Design Patterns"
tags: ["adapter", "design-pattern", "integration", "spring"]
---

HMS ban đầu dùng VNPay để xử lý thanh toán. Sau 6 tháng, product team quyết định thêm Momo vì nhiều bệnh nhân không có thẻ ngân hàng. Tháng sau thêm ZaloPay. Mỗi provider có SDK riêng, interface riêng, error code riêng.

Nếu `PaymentService` gọi thẳng VNPay SDK, Momo SDK, ZaloPay SDK — mỗi lần thêm provider là bạn phải sửa `PaymentService`. Mỗi lần provider đổi API là bạn phải sửa business logic.

Đây chính xác là bài GoF viết Adapter để giải.

---

## Adapter là cái phích cắm chuyển

Bạn đi Mỹ, cầm cái sạc điện thoại cắm vào ổ điện Mỹ không vừa. Bạn mua cái adapter phích cắm — không thay đổi gì ở cái sạc, không thay đổi gì ở ổ điện, chỉ làm cho hai thứ đó fit nhau.

GoF mô tả chính xác như vậy: **Adapter chuyển đổi interface của một class thành interface khác mà client mong đợi. Cho phép các class có interface không tương thích làm việc được với nhau.**

Quan trọng: Adapter không thay đổi behavior. Nó chỉ wrap và translate.

---

## Ví dụ thực tế: payment gateway integration

Đây là interface mà `PaymentService` của HMS cần — interface của domain:

```java
// Interface của HMS — domain không biết gì về VNPay hay Momo
public interface PaymentGateway {
    PaymentResult charge(PaymentRequest request);
    RefundResult refund(String transactionId, long amount);
}

public record PaymentRequest(
    String orderId,
    long amountVnd,
    String description,
    String returnUrl
) {}

public record PaymentResult(
    String transactionId,
    PaymentStatus status,
    String redirectUrl
) {}
```

VNPay SDK có interface hoàn toàn khác — tên method khác, kiểu dữ liệu khác, error handling khác:

```java
// VNPay SDK — bạn không sửa được cái này
public class VnPayClient {
    public VnPayResponse createPaymentUrl(VnPayRequest vnPayRequest) { /* ... */ }
    public VnPayRefundResponse requestRefund(String txnRef, Long amount, String reason) { /* ... */ }
}
```

Adapter wrap VNPay để nói ngôn ngữ của HMS:

```java
@Component
@RequiredArgsConstructor
public class VnPayGatewayAdapter implements PaymentGateway {

    private final VnPayClient vnPayClient;  // SDK của VNPay

    @Override
    public PaymentResult charge(PaymentRequest request) {
        // Translate từ HMS request sang VNPay request
        var vnPayRequest = VnPayRequest.builder()
            .vnp_TxnRef(request.orderId())
            .vnp_Amount(request.amountVnd() * 100)  // VNPay tính bằng đồng, nhân 100
            .vnp_OrderInfo(request.description())
            .vnp_ReturnUrl(request.returnUrl())
            .build();

        VnPayResponse response = vnPayClient.createPaymentUrl(vnPayRequest);

        // Translate từ VNPay response sang HMS result
        return new PaymentResult(
            response.getVnp_TxnRef(),
            mapVnPayStatus(response.getVnp_ResponseCode()),
            response.getPaymentUrl()
        );
    }

    @Override
    public RefundResult refund(String transactionId, long amount) {
        var response = vnPayClient.requestRefund(transactionId, amount, "Customer request");
        return new RefundResult(
            mapVnPayRefundStatus(response.getResponseCode()),
            response.getMessage()
        );
    }

    private PaymentStatus mapVnPayStatus(String responseCode) {
        return switch (responseCode) {
            case "00" -> PaymentStatus.SUCCESS;
            case "24" -> PaymentStatus.CANCELLED;
            default   -> PaymentStatus.FAILED;
        };
    }
}
```

Tương tự cho Momo:

```java
@Component
@RequiredArgsConstructor
public class MomoGatewayAdapter implements PaymentGateway {

    private final MomoApiClient momoClient;

    @Override
    public PaymentResult charge(PaymentRequest request) {
        // Momo có structure khác, auth khác, error code khác
        // Nhưng PaymentService không biết — nó chỉ thấy PaymentGateway
        var momoReq = new MomoPaymentRequest();
        momoReq.setOrderId(request.orderId());
        momoReq.setAmount(request.amountVnd()); // Momo tính đúng VND, không nhân 100
        // ...
        var res = momoClient.createOrder(momoReq);
        return new PaymentResult(res.getOrderId(), mapMomoStatus(res.getResultCode()), res.getPayUrl());
    }

    // ...
}
```

`PaymentService` chỉ biết `PaymentGateway`. Không biết VNPay tồn tại. Không biết Momo tồn tại:

```java
@Service
@RequiredArgsConstructor
public class PaymentService {

    private final PaymentGateway paymentGateway; // inject adapter, không biết là cái gì

    public PaymentResult processPayment(CreatePaymentRequest req) {
        var request = new PaymentRequest(req.orderId(), req.amount(), req.description(), req.returnUrl());
        return paymentGateway.charge(request);
    }
}
```

---

## Adapter vs Facade — dễ lẫn

Cả hai đều wrap thứ gì đó và cung cấp interface đơn giản hơn. Khác nhau ở mục đích:

**Facade** (bài 44) đơn giản hóa interface phức tạp — giảm số method, gom nhiều operation thành một. Caller vẫn dùng cùng một "ngôn ngữ", chỉ đơn giản hơn.

**Adapter** translate giữa hai interface không tương thích — client nói ngôn ngữ A, library nói ngôn ngữ B, Adapter dịch. Không nhất thiết đơn giản hơn, chỉ cần tương thích hơn.

Trong ví dụ trên: nếu `PaymentService` biết về VNPay và chỉ muốn API đơn giản hơn → Facade. Nếu `PaymentService` không biết VNPay tồn tại và chỉ nói ngôn ngữ HMS → Adapter.

---

## Khi nào không cần Adapter

Adapter hữu ích khi có hai interface không khớp và bạn không thể sửa một trong hai. Nếu bạn đang viết cả hai bên, đừng tạo ra sự không tương thích rồi viết Adapter để fix — thiết kế interface đúng từ đầu là câu trả lời đúng hơn.

Cũng không nên dùng Adapter như một cách che giấu interface xấu của code mình viết. Adapter che giấu sự không tương thích của *external* dependency — không phải để bạn trốn trách nhiệm thiết kế interface nội bộ.

---

## Takeaway

Adapter xuất hiện tự nhiên khi bạn integrate với third-party SDK, legacy system, hoặc external API mà bạn không kiểm soát được interface của họ. Dấu hiệu cần Adapter: code của bạn phải biết quá nhiều về internal của external library để gọi nó. Khi đó hãy đặt một lớp translate ở giữa — giữ domain language của bạn sạch, để Adapter chịu trách nhiệm dịch thuật.

---

*Bài tiếp theo: Composite — khi cây và lá phải được xử lý như nhau*
