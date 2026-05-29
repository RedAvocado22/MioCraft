---
title: "Senior không review code — senior review change"
description: "Khi review PR, senior không chỉ đọc code — họ hỏi: change này có đúng direction không? Có tạo ra dependency mới không? Có làm hệ thống khó thay đổi hơn không?"
category: programming
pubDate: 2024-02-17
series: "Phần 5: Design Patterns"
tags: ["mindset", "code-review", "senior"]
---

Có một câu hỏi tao hay hỏi junior khi họ mở pull request: *"Cái này thay đổi gì trong hệ thống?"*

Câu trả lời thường là: *"Thêm Strategy Pattern cho payment processing."*

Đó là mô tả về code, không phải về change.

Câu trả lời tao muốn nghe là: *"Trước đây mỗi lần thêm payment method mới phải sửa `PaymentService`. Bây giờ không cần nữa — chỉ cần thêm một implementation mới. Ngoài ra, test coverage cho payment logic tăng lên vì giờ tao có thể mock từng strategy độc lập."*

Đó mới là suy nghĩ về change.

---

## Code và change không phải một

Junior đọc code và thấy lines. Senior đọc code và thấy hệ thống đang thay đổi như thế nào.

Khi mày submit một pull request với 300 dòng thay đổi, tao không chỉ hỏi "code này đúng không?" Tao hỏi:

- Behavior nào đang thay đổi? Behavior nào tưởng không đổi nhưng thực ra bị ảnh hưởng?
- Risk ở đâu? Phần nào dễ break nhất?
- Ai sẽ phải sửa code này tiếp theo, và họ sẽ gặp khó khăn gì?
- Nếu cái này fail lúc production, làm sao debug?

Mày có thể viết một Strategy Pattern hoàn hảo về mặt cú pháp và design — nhưng nếu mày không nghĩ đến những câu hỏi đó, pull request của mày vẫn có thể là một time bomb.

---

## Ví dụ: cùng một change, hai cách nhìn

Mày refactor `DoctorScheduleService` để dùng caching. Change nhìn từ góc độ code:

> "Thêm `@Cacheable` vào `getAvailableSchedules`, thêm `@CacheEvict` vào `updateSchedule`."

Change nhìn từ góc độ hệ thống:

> "Read path sẽ nhanh hơn đáng kể. Nhưng bây giờ có một khoảng lag tối đa 5 phút giữa khi doctor cập nhật lịch và khi patient thấy lịch mới. Nếu doctor xóa một slot mà đã có patient book rồi trong khoảng lag đó — `AppointmentService` vẫn thấy slot đó là available và cho phép booking. Đây là một edge case mới mà trước đây không tồn tại."

Version 2 là cách senior nghĩ. Không phải vì họ giỏi hơn về syntax — mà vì họ đã từng bị đốt bởi đúng loại edge case đó.

---

## Những thứ mày cần nghĩ khi tạo PR

**Behavior change là gì, kể cả behavior không cố ý.** Thêm index vào database column làm SELECT nhanh hơn — nhưng cũng làm INSERT/UPDATE chậm hơn một chút. Cả hai đều là behavior change. Mày có kể cả cái không cố ý trong PR description không?

**Test coverage có theo kịp không?** Không phải "tao đã viết test" mà là "test đang cover đúng những gì có thể break." Một Strategy Pattern mới cần test cho từng implementation, test cho edge case khi không có implementation nào match, và test cho cái default behavior.

**Dependency mới có ảnh hưởng ai không?** Mày inject thêm một service vào `AppointmentService` — service đó có những trường hợp throw exception không? Khi nó unavailable, `AppointmentService` sẽ degrade như thế nào?

**Backward compatibility.** Nếu PR này thay đổi response format của một API — frontend đang dùng cái gì? Mobile app cũ hơn còn đang gọi endpoint đó không?

---

## Tại sao phần Design Patterns kết thúc bằng bài này

Bảy bài trước của Phần 5 nói về từng pattern cụ thể — Template Method, Strategy, Observer, Facade, Decorator, Proxy, Command. Nếu mày học hết và chỉ rút ra được *"khi nào dùng pattern nào"*, mày học được 50% giá trị.

50% còn lại là: **design là về những gì thay đổi theo thời gian, không phải về cấu trúc lúc này.**

Template Method không chỉ là "đặt shared logic vào abstract class." Nó là một quyết định về: *những bước nào sẽ cố định trong suốt vòng đời của codebase, và những bước nào sẽ thay đổi khi requirement thay đổi?*

Strategy không chỉ là "inject behavior từ ngoài vào." Nó là: *nếu tao thêm một payment method mới ngày mai, tao muốn thay đổi đó được isolated ở đâu, và tao không muốn phải touch đến đâu?*

Observer không chỉ là "decouple producer và consumer." Nó là: *khi một appointment được confirm, số lượng thứ cần xảy ra sẽ tăng lên theo thời gian — tao muốn đảm bảo mỗi cái đó có thể được thêm mà không cần sửa core flow.*

Pattern là ngôn ngữ để nói về change. Không phải về code.

---

## Takeaway

Lần tới trước khi submit PR, viết một đoạn ngắn — không phải cho reviewer, mà cho chính mày — về *change* mày đang đưa vào hệ thống. Không phải mày đã làm gì. Mà là hệ thống sẽ behave như thế nào khác đi sau PR này, kể cả những thứ mày không cố ý. Nếu mày không viết được đoạn đó — mày chưa hiểu đủ change của mình.

---

*Bài tiếp theo: Index là gì — và tại sao tạo index rồi query vẫn chậm?*
