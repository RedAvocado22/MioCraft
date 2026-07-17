---
title: "Hợp đồng đã ký phải nhớ quá khứ"
description: "Đọc tên và giá trị live từ service khác khiến nội dung hợp đồng thay đổi theo dữ liệu hiện tại. Snapshot có chủ ý bảo vệ lịch sử và domain invariant."
category: architecture
pubDate: 2026-07-17
addedDate: 2026-07-17
series: "Phần 6: Database"
tags: ["denormalization", "snapshot", "ddd", "contracts", "case-study"]
---

Một hợp đồng được ký khi hợp tác xã có tên “Nông sản A”. Sáu tháng sau tổ chức đổi tên thành “Nông sản B”. Khi mở lại hợp đồng cũ, hệ thống gọi user-service và hiển thị tên mới.

Database không mất dữ liệu. API cũng trả đúng dữ liệu hiện tại. Nhưng tài liệu lịch sử đã bị thay đổi ý nghĩa.

## Foreign key không đủ cho dữ liệu lịch sử

Thiết kế ban đầu thường chỉ lưu ID:

```text
contract
  buyer_id
  seller_id
  listing_id
```

Khi cần render hợp đồng, service gọi sang:

```text
user-service    → organizationName
product-service → productName, quantity, price
```

Cách này giảm duplicate data nhưng biến hợp đồng thành một view của **hiện tại**. Tên tổ chức, tên sản phẩm hoặc listing có thể được chỉnh sửa sau khi ký.

Với hợp đồng, dữ liệu tại thời điểm ký mới là sự thật cần giữ.

## Snapshot có chủ ý

Contract có thể lưu:

```java
public final class Contract {
    private UUID buyerId;
    private UUID sellerId;
    private UUID listingId;

    private String buyerNameSnapshot;
    private String sellerNameSnapshot;
    private String productNameSnapshot;
    private Quantity agreedQuantity;
    private Money agreedPrice;
}
```

ID vẫn giữ để trace về entity gốc. Snapshot trả lời câu hỏi khác: “Tại thời điểm giao kết, hai bên đã nhìn thấy và đồng ý điều gì?”

Đây không phải denormalization vì lười JOIN. Nó là domain invariant.

## Snapshot lúc nào?

Có hai thời điểm thường gặp:

- **Khi tạo offer:** giữ đúng nội dung hai bên bắt đầu negotiate.
- **Khi cả hai ký:** đóng băng version cuối cùng đã được chấp nhận.

Nếu terms được phép thay đổi trong giai đoạn `NEGOTIATING`, snapshot cuối cùng phải phản ánh bản được ký. Sau `SIGNED`, value object terms nên immutable; muốn thay đổi cần amendment hoặc contract mới, không sửa âm thầm record cũ.

## Dữ liệu nào nên snapshot?

Snapshot khi dữ liệu:

- xuất hiện trong cam kết hoặc chứng từ;
- cần audit lại theo thời điểm;
- có thể thay đổi ở source service;
- cần để consumer xử lý mà không gọi ngược producer.

Ví dụ phù hợp:

- tên pháp lý hiển thị trên hợp đồng;
- tên sản phẩm và grade;
- quantity, unit, price, currency;
- delivery deadline;
- penalty rate đã negotiate;
- email nhận notification tại thời điểm event, nếu business yêu cầu.

Không cần snapshot mọi field profile như avatar, theme hay địa chỉ UI không liên quan đến cam kết.

## Snapshot không đồng nghĩa với copy rồi quên nguồn

Một model tốt giữ cả ID và snapshot:

```text
sellerId           → identity hiện tại, authorization, truy vết
sellerNameSnapshot → nội dung lịch sử của contract
```

Khi hiển thị profile hiện tại, đọc user-service. Khi render hợp đồng đã ký, đọc snapshot. Hai use case có source of truth khác nhau.

Nếu source entity bị xóa hoặc service tạm thời down, hợp đồng cũ vẫn render được. Đây cũng là một lợi ích fault isolation.

## Snapshot trong event

Notification-service cần gửi “Công ty X đã ký”. Nếu contract-service đã có snapshot tên tổ chức, event nên mang tên đó thay vì chỉ gửi `userId` rồi bắt consumer gọi Feign.

```java
public record ContractSignedEvent(
    UUID contractId,
    String buyerName,
    String sellerName,
    Money totalAmount
) {}
```

Event đang mô tả fact tại một thời điểm, nên snapshot là dữ liệu tự nhiên của nó.

## Test điều mà normalization không bắt được

Một test quan trọng:

1. Tạo offer với seller name A.
2. Ký contract.
3. Đổi seller profile thành B.
4. Đọc lại contract.
5. Assert hợp đồng vẫn hiển thị A, profile hiện tại hiển thị B.

Nếu cả hai đều thành B, hệ thống đang trả lời sai câu hỏi lịch sử.

## Takeaway

Normalization giúp dữ liệu hiện tại nhất quán. Snapshot giúp dữ liệu lịch sử trung thực.

Với hợp đồng, hóa đơn, payment receipt và audit event, đừng chỉ lưu ID rồi hy vọng source data không đổi. Hãy xác định rõ field nào là tham chiếu hiện tại và field nào phải được đóng băng tại business milestone.

---

*Bài liên quan: Normalization vs Denormalization — chuẩn hóa bao nhiêu là đủ?*
