---
title: "Async rồi vẫn coupling — đừng biến consumer thành client ngược"
description: "Nhận event xong lại gọi ngược producer để lấy dữ liệu khiến consumer vẫn phụ thuộc đồng bộ. Event-carried state transfer cắt chuỗi lỗi đó."
category: system-design
pubDate: 2026-07-17
series: "Phần 7: Backend & Hệ thống"
tags: ["event-driven", "rabbitmq", "coupling", "microservices", "case-study"]
---

Notification-service nhận được event `escrow.penalized`. Event chỉ có `escrowId` và bên bị phạt, nên consumer gọi ngược escrow-service để lấy số tiền rồi mới gửi email.

Nhìn qua vẫn là kiến trúc async: producer publish RabbitMQ, consumer xử lý riêng. Nhưng giữa method consumer lại xuất hiện một lời gọi Feign đồng bộ.

Nếu escrow-service đang down, notification-service cũng không xử lý được message. Event bị retry, queue bắt đầu dồn, rồi message rơi vào DLQ. Một outage đã lan sang service vốn được tách ra để tránh chính chuyện đó.

## Queue không tự động tạo ra decoupling

Flow ban đầu:

```text
escrow-service
  → publish escrow.penalized { escrowId, party }
  → RabbitMQ
  → notification-service
      → GET /escrows/{id}/transactions
      → gửi email
```

Consumer không phụ thuộc producer ở thời điểm message được gửi, nhưng lại phụ thuộc producer ở thời điểm message được xử lý. Đây là **temporal coupling** được dời sang chỗ khác, không phải được loại bỏ.

Queue vẫn có ích cho buffering và retry. Nhưng mục tiêu fault isolation chưa đạt được.

## Event mang đủ dữ liệu cần thiết

Nếu producer đã biết số tiền tại thời điểm phát event, hãy đưa nó vào payload:

```java
public record EscrowPenalizedEvent(
    UUID eventId,
    UUID escrowId,
    Party penalizedParty,
    BigDecimal penaltyAmount,
    String currency,
    Instant occurredAt
) {}
```

Flow mới:

```text
escrow-service
  → publish { escrowId, party, penaltyAmount, currency }
  → RabbitMQ
  → notification-service
      → render email
      → gửi email
```

Escrow-service có thể down ngay sau khi publish. Consumer vẫn có đủ dữ liệu để hoàn thành công việc.

Pattern này thường được gọi là **event-carried state transfer**: event không chỉ báo “có chuyện xảy ra”, mà mang phần state mà consumer hợp lệ cần dùng.

## Event không cần mang toàn bộ aggregate

Giải pháp không phải serialize nguyên `EscrowAccount` rồi phát cho mọi nơi. Payload chỉ cần đủ cho business fact đó:

- `eventId` để deduplicate;
- aggregate ID để trace;
- bên nhận hoặc bên bị phạt;
- số tiền và currency;
- thời điểm xảy ra;
- version của schema nếu event sẽ sống lâu.

Không đưa field nội bộ không consumer nào cần. Event quá lớn làm tăng coupling theo schema và có thể vô tình lộ dữ liệu nhạy cảm.

## Business event khác ledger event

Một lần release escrow có thể tạo nhiều dòng ledger: trả tiền cho seller, hoàn deposit, ghi phí. Không nhất thiết mỗi dòng ledger phải trở thành một event public.

Consumer thường quan tâm **business milestone**:

```text
escrow.released
escrow.penalized
escrow.refunded
```

Mỗi event có thể mang các amount đã được tính tại thời điểm transition. Ledger vẫn là audit detail thuộc escrow-service; notification-service không cần biết cấu trúc bảng giao dịch bên trong.

Nhờ vậy producer có thể refactor ledger mà không bắt consumer sửa theo.

## Cái giá của event giàu dữ liệu

Event-carried state transfer cũng có trade-off:

- Payload lớn hơn.
- Một dữ liệu có thể xuất hiện ở nhiều service.
- Schema event phải được version cẩn thận.
- Consumer đang giữ snapshot, không phải state mới nhất.

Nhưng với notification, audit email hoặc analytics, snapshot tại thời điểm event thường chính là dữ liệu đúng. Email “bạn được hoàn 10 triệu” không nên đổi theo số dư hiện tại một tuần sau.

## Khi nào consumer có thể gọi API?

Không phải mọi callback đều sai. Có thể chấp nhận khi:

- dữ liệu bắt buộc phải là mới nhất tại thời điểm xử lý;
- operation không critical, fail có thể bỏ qua;
- producer cung cấp API ổn định và có circuit breaker;
- consumer có chiến lược retry/reconciliation rõ ràng.

Nhưng nếu dữ liệu đã tồn tại ngay lúc producer tạo event, gọi ngược chỉ để lấy lại dữ liệu đó thường là dấu hiệu payload đang quá mỏng.

## Takeaway

Async transport không bảo đảm kiến trúc đã decoupled. Nếu consumer nhận event rồi phải gọi ngược producer mới làm được việc, failure chain vẫn còn nguyên.

Hãy để event mang đủ state của business fact. Consumer nên có thể xử lý message ngay cả khi producer đang tắt — đó mới là fault isolation mà queue được kỳ vọng mang lại.

---

*Bài liên quan: Message đã vào queue nhưng handler chưa chạy.*
