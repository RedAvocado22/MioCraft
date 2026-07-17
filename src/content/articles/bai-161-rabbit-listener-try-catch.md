---
title: "Một try/catch quá rộng có thể biến lỗi business thành message hỏng"
description: "Bọc cả @RabbitListener trong một catch khiến lỗi DB tạm thời bị gắn nhãn payload sai và mất cơ hội retry. Error boundary phải đặt đúng chỗ."
category: system-design
pubDate: 2026-07-17
series: "Phần 7: Backend & Hệ thống"
tags: ["rabbitmq", "error-handling", "retry", "dlq", "case-study"]
---

Một consumer nhận event hợp lệ, parse thành công, nhưng database timeout khi use case đang save aggregate. Lỗi này đáng được retry sau vài giây.

Tuy nhiên code lại wrap toàn bộ method trong một `try/catch` và ném ra `InvalidEventPayloadException`. Retry policy coi exception đó là non-retryable, message đi thẳng vào DLQ.

Business operation có thể thành công ở lần thử thứ hai, nhưng code đã tự tước mất cơ hội đó.

## Đoạn code trông gọn nhưng làm mất ngữ nghĩa lỗi

```java
@RabbitListener(queues = "contract-svc.escrow.locked")
public void onEscrowLocked(Map<String, Object> payload) {
    try {
        var event = parseEscrowLocked(payload);
        activateContractUseCase.execute(event);
    } catch (Exception ex) {
        throw new InvalidEventPayloadException("Invalid escrow.locked", ex);
    }
}
```

Catch block đang gộp nhiều nhóm lỗi hoàn toàn khác nhau:

- thiếu `eventId` hoặc sai kiểu field;
- contract không tồn tại;
- state transition không hợp lệ;
- database connection timeout;
- optimistic lock conflict;
- bug lập trình bất ngờ.

Sau khi bị wrap, retry interceptor chỉ còn nhìn thấy một loại exception: “payload sai”. Hệ thống mất thông tin cần thiết để quyết định retry hay fail fast.

## Chỉ catch phần bạn thật sự xử lý được

Tách parsing thành một error boundary nhỏ:

```java
@RabbitListener(queues = "contract-svc.escrow.locked")
public void onEscrowLocked(Map<String, Object> payload) {
    var event = parse(payload);

    // Chạy ngoài try/catch parse để exception giữ nguyên bản chất
    activateContractUseCase.execute(event);
}

private EscrowLockedEvent parse(Map<String, Object> payload) {
    try {
        return new EscrowLockedEvent(
            UUID.fromString((String) payload.get("eventId")),
            UUID.fromString((String) payload.get("contractId"))
        );
    } catch (RuntimeException ex) {
        throw new InvalidEventPayloadException("Invalid escrow.locked", ex);
    }
}
```

Bây giờ:

- parse fail → `InvalidEventPayloadException` → fail fast hoặc DLQ ngay;
- DB timeout → giữ exception hạ tầng → retry với backoff;
- business invariant fail → log/alert theo policy riêng;
- bug bất ngờ → không bị giả dạng thành lỗi dữ liệu.

## Retry policy dựa vào nguyên nhân, không dựa vào nơi lỗi xảy ra

Một policy đơn giản:

| Nhóm lỗi | Ví dụ | Xử lý |
|---|---|---|
| Payload vĩnh viễn sai | thiếu field, UUID lỗi | Không retry, đưa DLQ |
| Hạ tầng tạm thời | DB timeout, broker/network chập chờn | Retry có backoff |
| Duplicate | event đã xử lý, state đã ở đích | Idempotent skip |
| Business conflict | transition không hợp lệ | Alert hoặc reconciliation |
| Bug không biết trước | `NullPointerException` | Retry giới hạn rồi DLQ + alert |

Retry tất cả gây retry storm. Không retry gì làm mất khả năng tự phục hồi. Phân loại exception là một phần của thiết kế consumer, không chỉ là chuyện clean code.

## DLQ cần giữ nguyên nguyên nhân

Khi message vào DLQ, người xử lý cần biết:

- event nào;
- routing key nào;
- exception gốc là gì;
- đã retry bao nhiêu lần;
- business ID liên quan;
- consumer version nào xử lý.

Nếu mọi thứ đều bị wrap thành `InvalidEventPayloadException`, DLQ mất giá trị chẩn đoán. Nó chỉ còn là nơi chứa message không biết tại sao thất bại.

## Test error boundary bằng failure injection

Đừng chỉ test happy path. Ít nhất cần có:

1. Payload thiếu field → không gọi use case.
2. Payload hợp lệ, repository timeout → exception hạ tầng bubble ra.
3. Event duplicate → handler trả thành công mà không mutate lần hai.
4. Business state lệch → policy reconciliation được kích hoạt.

Mocking repository throw timeout giúp kiểm tra consumer không vô tình đổi loại exception. Integration test với broker giúp kiểm tra retry count và DLQ routing thật.

## Takeaway

`try/catch` không chỉ quyết định log gì. Trong consumer, nó quyết định message được retry, bỏ qua hay đưa vào DLQ.

Chỉ catch quanh bước parse nếu mục tiêu là đổi lỗi parse. Để business và infrastructure exception giữ nguyên ngữ nghĩa — vì retry policy không thể đưa ra quyết định đúng khi code đã gọi mọi lỗi là “payload sai”.

---

*Bài liên quan: Đừng nuốt lỗi — hệ thống sẽ trả giá thay bạn.*
