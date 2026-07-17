---
title: "DLQ không phải thùng rác — retry và reconciliation trong Saga"
description: "Retry xử lý lỗi tạm thời, DLQ giữ message không xử lý được, còn reconciliation phát hiện cả những event chưa từng tới queue. Cần đủ cả ba lớp."
category: system-design
pubDate: 2026-07-17
series: "Phần 12: Production & Ops"
tags: ["dlq", "retry", "reconciliation", "saga", "rabbitmq"]
---

Contract đã chuyển `DELIVERED`, nhưng escrow vẫn `FULLY_LOCKED` sau ba mươi phút. Không có message trong DLQ.

Team mở RabbitMQ và kết luận consumer không lỗi. Nhưng event có thể chưa từng rời outbox, publish nhầm exchange, hoặc bị drop vì chưa có binding. DLQ chỉ nhìn thấy message đã đi đến consumer rồi thất bại; nó không quan sát toàn bộ Saga.

## Ba lớp giải ba failure mode khác nhau

```text
Retry          → lỗi tạm thời, thử lại có thể thành công
DLQ            → message đã tới consumer nhưng không xử lý được
Reconciliation → business state lệch, bất kể message đã đi đâu
```

Chỉ có DLQ giống như đặt thùng cứu hộ ở cuối đường nhưng không kiểm tra xe có rời bến hay không.

## Retry có giới hạn

Database restart hoặc network chập chờn thường tự hồi phục. Đưa message vào DLQ ngay lần đầu khiến người vận hành phải sửa tay một lỗi đáng lẽ hệ thống tự xử lý được.

Policy có thể là:

```text
attempt 1 → ngay lập tức
attempt 2 → sau 1 giây
attempt 3 → sau 5 giây
vẫn fail  → reject, không requeue → DLQ
```

Không retry payload chắc chắn sai như thiếu field bắt buộc. Retry không thể biến một UUID hỏng thành UUID đúng.

## DLQ phải có ngữ cảnh và owner

Mỗi queue chính nên có dead-letter path rõ ràng. Tách DLQ theo consumer hoặc event giúp biết ngay handler nào đang gãy:

```text
escrow-svc.contract.signed.dlq
escrow-svc.contract.delivered.dlq
contract-svc.escrow.locked.dlq
```

Một DLQ dùng chung cho mọi service tiết kiệm vài dòng config nhưng làm incident khó đọc hơn.

DLQ cũng cần:

- alert khi depth > 0;
- dashboard tuổi message lâu nhất;
- runbook replay sau khi fix;
- lưu exception và `x-death` headers;
- owner chịu trách nhiệm xử lý.

Không có alert và quy trình replay, DLQ chỉ là nơi message biến mất có tổ chức.

## Reconciliation nhìn vào business invariant

Reconciliation job không hỏi “message nào fail?”. Nó hỏi “state nào không thể hợp lý sau thời gian X?”

Ví dụ:

```text
Contract = DELIVERED
Escrow   = FULLY_LOCKED
Age      > 10 phút
```

Theo Saga, `contract.delivered` phải dẫn đến escrow `RELEASED`. Nếu không, job tạo alert hoặc enqueue một command repair idempotent.

Pseudo-code:

```java
@Scheduled(fixedDelayString = "${reconciliation.delay}")
public void findStuckEscrows() {
    var candidates = escrowRepository
        .findFullyLockedOlderThan(Instant.now().minus(Duration.ofMinutes(10)));

    for (var escrow : candidates) {
        var contract = contractClient.getContract(escrow.getContractId());
        if (contract.status() == DELIVERED) {
            alertService.raiseStuckSaga(contract.id(), escrow.id());
        }
    }
}
```

Ở hệ thống lớn hơn, read model hoặc audit stream có thể thay synchronous client. Điều quan trọng là invariant được kiểm tra độc lập với đường message.

## Vì sao reconciliation bắt được thứ DLQ bỏ sót?

Event có thể mất trước consumer vì:

- aggregate save thành công nhưng outbox row không được ghi cùng transaction;
- poller crash hoặc query sai status;
- publish nhầm exchange/routing key;
- queue/binding chưa được declare;
- message hết TTL trước khi consumer online;
- bug deploy làm consumer chưa bao giờ subscribe.

Không case nào chắc chắn tạo DLQ entry. Nhưng tất cả đều để lại state business lệch — và reconciliation nhìn thấy điều đó.

## Repair phải idempotent

Job không nên tự động release tiền chỉ vì thấy một record lạ nếu chưa đủ bằng chứng. Có thể chia mức:

1. Detect và log structured anomaly.
2. Alert cho operator.
3. Retry publish event gốc nếu payload có thể tái tạo an toàn.
4. Chạy command repair idempotent sau khi verify invariant.

Với operation tài chính, auto-repair cần audit trail và guard chặt. “Tự chữa” không được biến thành “tự chuyển tiền hai lần”.

## Takeaway

Retry, DLQ và reconciliation không cạnh tranh nhau:

- Retry chữa lỗi tạm thời.
- DLQ giữ bằng chứng của message đã thất bại.
- Reconciliation phát hiện Saga bị kẹt kể cả khi message chưa từng tới consumer.

Một hệ thống event-driven chỉ monitor queue depth vẫn đang nhìn hạ tầng, chưa nhìn business. Alert tốt nhất đôi khi không phải “DLQ có 1 message”, mà là “contract đã giao hàng nhưng tiền vẫn chưa được release”.

---

*Bài liên quan: Alert design — on-call không chết vì noise.*
