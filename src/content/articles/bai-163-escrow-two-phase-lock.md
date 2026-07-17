---
title: "Escrow không thể nhảy thẳng từ SIGNED sang ACTIVE"
description: "Ký hợp đồng và khóa đủ tiền là hai business fact khác nhau. Two-phase lock làm rõ buyer payment, seller deposit và thời điểm contract thật sự có hiệu lực."
category: system-design
pubDate: 2026-07-17
addedDate: 2026-07-17
series: "Phần 8: System Design"
tags: ["escrow", "state-machine", "saga", "payments", "case-study"]
---

Hai bên đã ký contract không có nghĩa tiền đã được bảo đảm. Nếu hệ thống chuyển thẳng `SIGNED → ACTIVE`, seller có thể bắt đầu giao hàng trong lúc buyer chưa lock payment hoặc seller chưa hoàn tất deposit.

Chữ ký là cam kết pháp lý. Escrow là cam kết tài chính. Hai business fact này cần hai state transition khác nhau.

## Contract và escrow có state machine riêng

Contract lifecycle:

```text
OFFERED → NEGOTIATING → SIGNED → ACTIVE → DELIVERED → SETTLED
```

Escrow lifecycle:

```text
— → BUYER_LOCKED → FULLY_LOCKED → RELEASED
```

Contract chỉ chuyển `SIGNED → ACTIVE` khi nhận event `escrow.locked`, tức escrow đã đạt `FULLY_LOCKED`.

Không nên gộp hai state machine thành một enum khổng lồ. Contract chịu trách nhiệm thỏa thuận và giao hàng; escrow chịu trách nhiệm tiền và ledger. Saga nối hai aggregate bằng event.

## Vì sao cần two-phase lock?

Flow đầy đủ:

```text
1. Buyer và Seller ký
2. contract-service publish contract.signed
3. escrow-service lock toàn bộ buyer payment
4. Escrow → BUYER_LOCKED
5. Seller xác nhận deposit
6. Escrow → FULLY_LOCKED
7. escrow-service publish escrow.locked
8. contract-service chuyển Contract → ACTIVE
```

Buyer payment và seller deposit là hai giao dịch tài chính khác nhau. Tách chúng giúp:

- audit biết bên nào đã hoàn tất nghĩa vụ;
- UI hiển thị chính xác đang chờ ai;
- retry từng bước độc lập;
- không phát `escrow.locked` quá sớm;
- tránh giao hàng khi tiền chưa đủ điều kiện.

## Một state trung gian không phải complexity thừa

Có thể thấy `BUYER_LOCKED` chỉ tồn tại trong thời gian ngắn và muốn bỏ nó. Nhưng nếu seller chưa deposit trong nhiều giờ, hệ thống cần trả lời:

- Tiền buyer đã bị giữ chưa?
- Ai đang block flow?
- Có được hủy hay timeout không?
- Notification phải gửi cho bên nào?
- Reconciliation job cần tìm state nào?

Một boolean `buyerPaid=true` nằm cạnh status `LOCKED` sẽ tạo state ngầm. Enum rõ ràng làm invariant có tên và kiểm soát transition tốt hơn.

## Event chỉ phát khi invariant đã đúng

Sai lầm nguy hiểm là publish `escrow.locked` ngay sau bước buyer lock:

```java
public void lockBuyerPayment(Money amount) {
    this.buyerPayment = amount;
    this.status = BUYER_LOCKED;
    // ❌ Chưa đủ điều kiện để contract ACTIVE
    registerEvent(new EscrowLockedEvent(contractId));
}
```

Event đúng phải xuất hiện khi aggregate đạt `FULLY_LOCKED`:

```java
public void lockSellerDeposit(Money deposit) {
    requireStatus(BUYER_LOCKED);
    this.sellerDeposit = deposit;
    this.status = FULLY_LOCKED;
    registerEvent(new EscrowLockedEvent(contractId));
}
```

Tên event là public contract. Nếu tên nói “locked” nhưng thực tế mới lock một nửa, mọi consumer sẽ xây logic trên một lời nói dối.

## Duplicate event và retry

RabbitMQ có thể giao lại `contract.signed`. Escrow consumer cần idempotent:

```java
if (escrowRepository.existsByContractId(event.contractId())) {
    return;
}
```

Database vẫn cần unique constraint trên `contract_id` để chặn hai consumer race. Tương tự, contract-service nhận lại `escrow.locked` khi đã `ACTIVE` nên no-op thay vì cố transition lần hai.

State guard và idempotency key bổ sung cho nhau; không cái nào thay thế hoàn toàn cái còn lại.

## Mock tiền không có nghĩa state machine là giả

MVP có thể dùng mock balance và không tích hợp ngân hàng thật. Nhưng các vấn đề kỹ thuật vẫn thật:

- atomic ledger update;
- idempotent event processing;
- transition hợp lệ;
- audit trail;
- Saga giữa contract và escrow.

Mock integration là trade-off scope. Bỏ invariant tài chính mới là bỏ mất bài toán cốt lõi.

## Takeaway

`SIGNED` chỉ nói hai bên đã đồng ý. `ACTIVE` phải nói mọi điều kiện để thực hiện hợp đồng đã hoàn tất.

Two-phase escrow lock làm rõ buyer đã khóa payment, seller đã khóa deposit và chỉ phát `escrow.locked` khi cả hai hoàn thành. State trung gian không phải ceremony — nó là nơi hệ thống ghi lại nghĩa vụ còn thiếu.

---

*Bài liên quan: State machine thanh toán — cancel đã trả tiền và refund.*
