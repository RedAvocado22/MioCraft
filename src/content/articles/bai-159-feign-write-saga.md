---
title: "Khi một lệnh Feign làm Saga mất nhất quán"
description: "Gọi REST đồng bộ để thay đổi dữ liệu của service khác tạo ra distributed write không có transaction chung. Đúng hơn là để service sở hữu state tự xử lý event."
category: architecture
pubDate: 2026-07-17
series: "Phần 3: Kiến trúc phần mềm"
tags: ["case-study", "microservices", "saga", "feign", "event-driven"]
---

Một contract vừa được ký. Contract-service gọi sang product-service để đóng listing. Request đóng listing trả về `200 OK`, nhưng ngay sau đó contract-service không lưu được trạng thái `SIGNED`.

Bây giờ hệ thống có hai sự thật:

```text
product-service: listing đã CLOSED
contract-service: contract vẫn chưa SIGNED
```

Không có transaction nào rollback được lời gọi Feign đã hoàn tất. Gọi thêm `reopenListing()` cũng chỉ tạo ra một remote call khác — nó có thể fail theo cách tương tự.

## Remote call không nằm trong transaction của bạn

Đoạn code trông khá tự nhiên:

```java
@Transactional
public void sign(SignCommand command) {
    contract.sign(command.userId());

    listingClient.closeListing(contract.getListingId()); // service khác

    contractRepository.save(contract);
}
```

`@Transactional` ở đây chỉ bảo vệ database của contract-service. Nó không mở rộng sang database của product-service, cũng không biến HTTP thành một phần của cùng transaction.

Nếu `closeListing()` thành công trước và `save()` fail sau đó, rollback chỉ hoàn tác được phần local. Listing vẫn đóng.

## Đảo thứ tự chỉ giảm rủi ro, không xóa vấn đề

Một cách sửa tối thiểu là lưu aggregate local trước, rồi mới gọi remote:

```java
@Transactional
public void sign(SignCommand command) {
    contract.sign(command.userId());
    contractRepository.save(contract); // source of truth của service này

    try {
        listingClient.closeListing(contract.getListingId());
    } catch (Exception ex) {
        log.error("Cannot close listing {} after contract signed",
            contract.getListingId(), ex);
    }
}
```

Cách này ưu tiên sự thật của contract-service. Nhưng nếu remote call fail vĩnh viễn, contract đã `SIGNED` còn listing vẫn `ACTIVE`. Buyer khác có thể tiếp tục offer trên listing đó — double-sell là rủi ro thật, không phải lỗi log cho đẹp.

Đây là trade-off có thể chấp nhận tạm thời trong một MVP, nhưng không nên biến thành pattern mặc định.

## Service sở hữu state nên tự thay đổi state

Nếu product-service sở hữu vòng đời listing, product-service nên là nơi quyết định và ghi trạng thái listing. Contract-service chỉ phát ra business fact:

```text
contract-service transaction:
  contract → SIGNED
  outbox   → contract.signed

product-service consumer:
  nhận contract.signed
  listing.close()
  save listing
```

Outbox bảo đảm event intent được ghi cùng transaction với contract. Consumer bên product-service có thể retry khi database tạm thời không sẵn sàng, ghi DLQ khi payload sai, và reconciliation job có thể phát hiện listing chưa đóng quá lâu.

Đây là khác biệt giữa:

- **“Tôi gọi service kia để sửa dữ liệu của nó.”**
- **“Tôi công bố business fact; service sở hữu dữ liệu tự phản ứng.”**

Vế thứ hai không làm hệ thống magically có strong consistency. Nó chấp nhận eventual consistency, nhưng failure được đặt ở nơi có thể retry và quan sát được.

## Feign vẫn có chỗ dùng

Kết luận không phải là “cấm mọi Feign call”. Đọc dữ liệu để kiểm tra hoặc snapshot thường hợp lý:

- lấy listing khi tạo offer;
- lấy tên tổ chức để snapshot vào contract;
- đọc trạng thái phục vụ một quyết định hiện tại.

Điểm nguy hiểm là **Feign write**: service A dùng HTTP để mutate aggregate mà service B sở hữu, rồi giả vờ đó là một phần của transaction local.

Nếu business bắt buộc phải có kết quả đồng bộ ngay, cần thiết kế Saga rõ ràng: state trung gian, retry, timeout, compensation và reconciliation. Chỉ thêm một `try/catch` quanh Feign không tạo ra những thứ đó.

## Event consumer cũng phải idempotent

Event có thể được giao lại. `product-service` không nên đóng listing hai lần rồi coi đó là lỗi nghiêm trọng:

```java
public void onContractSigned(ContractSignedEvent event) {
    var listing = listingRepository.findById(event.listingId())
        .orElseThrow();

    if (listing.isClosed()) {
        return; // retry cùng event — kết quả đã đạt rồi
    }

    listing.close();
    listingRepository.save(listing);
}
```

Cần thêm unique event key hoặc state guard tùy invariant. Event-driven không xóa duplicate; nó chỉ đưa duplicate vào một chỗ có thể xử lý có chủ đích.

## Khi nào nên dừng ở MVP?

Không phải đồ án nào cũng cần refactor ngay thành choreography hoàn chỉnh. Nếu scope chỉ cần demo happy path, có thể chọn giải pháp tối thiểu:

- save local state trước;
- log remote failure với đủ context;
- ghi rõ rủi ro consistency;
- đặt kế hoạch event-driven hóa ở phase sau;
- có test chứng minh failure mode.

Điều quan trọng là gọi đúng tên trade-off. “Đã dùng microservices” không có nghĩa mọi distributed write đã an toàn.

## Takeaway

`@Transactional` không thể bao trùm một lệnh Feign sang database khác. Gọi remote write trong use case local tạo ra một distributed transaction không có coordinator, thường chỉ được phát hiện sau khi hai service lệch state.

Hãy để service sở hữu aggregate tự mutate dữ liệu của nó qua event và outbox. Nếu chưa đủ thời gian để làm vậy, ghi nhận đó là trade-off có rủi ro — đừng nhầm một `try/catch` với tính nhất quán.

---

*Bài liên quan: Microservices không phải level up tự động từ Monolith.*
