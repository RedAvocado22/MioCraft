---
title: "Idempotency không phải là existsBy()"
description: "Check tồn tại trước khi save chỉ là bước đầu. Race condition, unique constraint và dữ liệu khác request mới quyết định một thao tác có thật sự idempotent hay không."
category: system-design
pubDate: 2026-07-17
series: "Phần 10: Case Studies thực tế"
tags: ["case-study", "idempotency", "concurrency", "database", "distributed-systems"]
---

Client gọi API tạo contract rồi timeout. Không biết server đã xử lý xong hay chưa, client gửi lại cùng request.

Đoạn code đầu tiên nhiều người viết là:

```java
if (repository.existsByContractId(command.contractId())) {
    return repository.findByContractId(command.contractId());
}

return repository.save(createNewContract(command));
```

Nhìn qua có vẻ idempotent. Nhưng `existsBy()` không phải khóa. Hai request có thể cùng nhìn thấy `false` rồi cùng tạo dữ liệu.

## Race condition nằm giữa hai dòng code

Giả sử database có unique constraint trên `contract_id`:

```text
Request A                     Request B
-----------                  -----------
exists? false                exists? false
save(contract-1)             save(contract-1)
commit                        unique violation
```

Nếu không có unique constraint, bạn có hai contract giống nhau. Nếu có constraint nhưng không xử lý exception, request thứ hai trả về `500` dù kết quả đúng về business thực ra là “contract đã tồn tại rồi”.

`existsBy()` giúp giảm phần lớn duplicate bình thường. Nó không làm check-then-act trở thành một thao tác atomic.

## Database là backstop, không phải kẻ thù

Thiết kế an toàn thường có ba lớp:

1. Check trước để trả kết quả nhanh trong trường hợp retry tuần tự.
2. Unique constraint để chặn race thật sự.
3. Xử lý `DataIntegrityViolationException` như tín hiệu “request khác đã thắng”.

Ví dụ:

```java
public Contract execute(CreateContractCommand command) {
    var existing = repository.findByContractId(command.contractId());
    if (existing.isPresent()) {
        return sameRequest(existing.get(), command)
            ? existing.get()
            : throwConflict(command.contractId());
    }

    try {
        return repository.save(Contract.offer(command));
    } catch (DataIntegrityViolationException ex) {
        // Một request khác có thể vừa insert cùng idempotency key
        var winner = repository.findByContractId(command.contractId());
        if (winner.isPresent()) {
            if (sameRequest(winner.get(), command)) {
                return winner.get();
            }
            throw new ConflictException("Same key, different payload");
        }
        throw ex;
    }
}
```

Trong code thật, `throwConflict()` sẽ trả về exception phù hợp thay vì dùng cú pháp placeholder như ví dụ trên. Điểm quan trọng là chỉ nuốt đúng lỗi duplicate đã biết. Không được bắt mọi lỗi database rồi giả vờ request thành công.

## Cùng một key, khác dữ liệu là conflict

Idempotency không có nghĩa là “cùng ID thì trả bất kỳ bản ghi nào”. Nếu request retry có cùng `contractId` nhưng khác `listingId`, buyer hoặc terms, đó là một request mâu thuẫn:

```text
contractId = 7f...
request lần 1: quantity = 100
request lần 2: quantity = 500
```

Trả lại contract cũ trong trường hợp này sẽ che giấu bug ở client. Tạo bản ghi thứ hai lại phá invariant. Kết quả đúng là `409 Conflict`, kèm log đủ context để điều tra.

## HTTP create và event consumer là hai bài toán khác nhau

Với **HTTP create**, idempotency key đại diện cho ý định của client. Retry cùng key và cùng dữ liệu nên trả lại kết quả cũ.

Với **event consumer**, key thường là `eventId`. Consumer cần ghi nhận event đã xử lý và kiểm tra state trước khi mutate:

```java
if (processedEventRepository.existsByEventId(event.eventId())) {
    return;
}

var account = escrowRepository.findByContractId(event.contractId());
if (account.isAlreadyLocked()) {
    return;
}

account.lockBuyerPayment(event.amount());
repository.save(account);
processedEventRepository.save(new ProcessedEvent(event.eventId()));
```

Hai cơ chế này liên quan nhưng không thay thế cho nhau. `contractId` giúp chống tạo lại aggregate; `eventId` giúp chống xử lý lại message. State guard giúp handler an toàn hơn khi message duplicate hoặc đến trễ.

## Một bug nhỏ ở value object có thể phá idempotency

Trong product service, request retry có thể gửi `10.0` ở lần đầu và `10.00` ở lần sau. Hai giá trị này bằng nhau về mặt nghiệp vụ, nhưng `BigDecimal.equals()` coi scale là một phần của phép so sánh:

```java
new BigDecimal("10.0").equals(new BigDecimal("10.00")); // false
```

Nếu `Money` hoặc `Quantity` dùng trực tiếp `equals()` của `BigDecimal`, lần retry hợp lệ có thể bị báo “payload khác”. Value object tiền và số lượng nên định nghĩa equality theo `compareTo()`, đồng thời có `hashCode()` tương thích.

Idempotency vì vậy không chỉ nằm ở controller hay database. Nó đi xuyên qua cách domain so sánh dữ liệu.

## Test race, không chỉ test retry tuần tự

Một test gọi request hai lần lần lượt sẽ không tạo ra TOCTOU race. Cần test đồng thời:

- Hai request cùng idempotency key chạy gần như cùng lúc.
- Một request commit, request kia nhận unique violation.
- Hai request có cùng key nhưng khác payload.
- Consumer nhận lại cùng event sau khi xử lý đã commit.
- Payload có số khác scale nhưng cùng giá trị.

Test phải assert cả HTTP status, số bản ghi trong database và số domain event được phát ra. Một bản ghi đúng nhưng event bị bắn hai lần vẫn là lỗi.

## Takeaway

`existsBy()` là tối ưu đường đi bình thường, không phải bảo đảm cuối cùng. Idempotency tốt cần:

- key ổn định và được persist;
- unique constraint ở database;
- xử lý race như kết quả hợp lệ;
- phân biệt request khác dữ liệu;
- state guard cho event duplicate;
- equality đúng ở value object.

Nếu chỉ có một câu `if (exists) return`, hệ thống chưa idempotent — nó chỉ đang hy vọng hai request không đến cùng lúc.

---

*Bài liên quan: Retry outbound và idempotency — khi hệ thống gọi gateway.*
