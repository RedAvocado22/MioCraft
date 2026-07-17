---
title: "Câu hỏi trước khi viết dòng code đầu tiên"
description: "Viết code nhanh không phải là viết ngay. Dành thời gian hỏi đúng câu hỏi giúp giảm số lần phải sửa lại."
category: programming
pubDate: 2024-01-03
series: "Phần 1: Tư duy lập trình"
tags: ["mindset", "requirements", "clarifying-questions"]
---

Khi mới nhận task, phản xạ tự nhiên là mở IDE ngay.

Khi có thêm kinh nghiệm, nhiều người sẽ ngồi yên một lúc — đôi khi mở notepad, đôi khi vẽ diagram, đôi khi chỉ nhìn chằm chằm vào màn hình. Rồi mới bắt đầu code.

Khoảng thời gian đó không phải là sự chần chừ. Đó là lúc đặt ra một loạt câu hỏi mà khi mới làm quen, nhiều người chưa có thói quen hỏi.

---

## Câu hỏi 1: "Mình có thật sự hiểu requirement không?"

Đây là câu hỏi đơn giản nhất nhưng bị bỏ qua nhiều nhất.

Khi nhận một task, có một phản xạ rất tự nhiên là mapping ngay requirement vào implementation — "cần làm X, vậy mình sẽ viết method Y gọi service Z." Nhưng trước khi làm điều đó, hãy dừng lại và đặt câu hỏi ngược: *tại sao feature này tồn tại?*

Ví dụ thực tế: task là "implement endpoint GET /doctor-schedules." Một cách tiếp cận vội có thể nghĩ ngay đến việc query database và trả về list. Một cách tiếp cận kỹ hơn sẽ hỏi thêm: ai gọi endpoint này? Receptionist để book lịch, hay patient để tự book, hay admin để quản lý? Câu trả lời ảnh hưởng trực tiếp đến filter nào cần có, field nào cần expose, permission nào cần check.

Viết code cho sai người dùng còn tệ hơn viết code chậm — vì code chậm có thể optimize, còn code sai thì phải bỏ đi và viết lại.

---

## Câu hỏi 2: "Edge case nào có thể làm cái này fail?"

Code happy path thì ai cũng làm được. Điểm khác biệt thường đến từ kinh nghiệm và khả năng nghĩ đến những thứ không được ghi trong requirement.

Trước khi viết code, hãy tự hỏi:

- Input này có thể null không? Empty không?
- Nếu concurrent request cùng lúc, chuyện gì xảy ra?
- Nếu external service (Keycloak, database) timeout, flow sẽ như thế nào?
- User có thể gửi request với data không hợp lệ theo cách không ai đoán trước không?

Ví dụ: implement book appointment. Happy path là user chọn slot còn trống, hệ thống book thành công. Nhưng điều gì xảy ra nếu hai user cùng book slot đó trong vòng milliseconds? Requirement không nói gì về điều này — nhưng nó sẽ xảy ra, và hệ thống cần xử lý đúng.

Không phải mọi edge case đều cần handle phức tạp. Nhưng bạn cần *biết* chúng tồn tại và đưa ra quyết định có ý thức — handle nó, accept nó là known limitation, hay escalate lên để confirm với stakeholder.

---

## Câu hỏi 3: "Mình đang đặt logic này ở đúng chỗ chưa?"

Đây là câu hỏi về architecture — và nó quan trọng hơn hầu hết mọi người nghĩ.

Logic nằm sai chỗ là một trong những nguyên nhân chính khiến codebase trở nên khó maintain theo thời gian. Một business rule nằm trong controller thay vì service. Một validation nằm trong database trigger thay vì application layer. Một side effect nằm trong repository thay vì được trigger qua domain event.

Câu hỏi đơn giản để kiểm tra: *"Nếu mình thay đổi database, hay thay đổi HTTP framework, cái logic này có cần viết lại không?"* Nếu có — nó đang nằm quá gần với infrastructure, và cần được kéo vào domain layer.

---

## Câu hỏi 4: "Làm sao mình biết cái này đúng?"

Trước khi viết code, hãy nghĩ đến cách bạn sẽ verify nó.

Không nhất thiết phải là unit test cho mọi thứ. Nhưng bạn cần có một kế hoạch kiểm tra rõ ràng: những happy case nào cần verify, những edge case nào cần check, những failure scenario nào cần thử.

Nếu bạn không thể mô tả cách bạn sẽ test một đoạn code trước khi viết nó — đó thường là signal rằng bạn chưa hiểu đủ rõ về những gì đoạn code đó cần làm.

---

## Câu hỏi 5: "Có cách nào đơn giản hơn không?"

Câu hỏi này nghe có vẻ trivial nhưng thực ra rất khó hỏi — vì khi bạn đã nghĩ ra một giải pháp, bộ não sẽ tự nhiên bảo vệ nó.

Trước khi bắt đầu implement, hãy dành 5 phút để challenge bản thân: *có cách nào đơn giản hơn để đạt được kết quả tương tự không?*

Ví dụ: bạn cần implement một cơ chế để prevent duplicate appointment booking. Giải pháp đầu tiên nảy ra trong đầu có thể là một distributed lock phức tạp với Redis. Nhưng nếu bạn dừng lại và hỏi "có cách đơn giản hơn không?" — bạn sẽ nhận ra rằng một database unique constraint hoặc một Lua atomic script có thể giải quyết vấn đề với ít moving part hơn rất nhiều.

Simple không phải simplistic. Simple là tìm được giải pháp ít phức tạp nhất giải quyết được vấn đề — không phải ít suy nghĩ nhất.

---

## Áp dụng thực tế

Lần tới khi nhận task, trước khi mở IDE, hãy dành 10-15 phút để trả lời năm câu hỏi này bằng văn bản — trong notepad, trong ticket comment, ở đâu cũng được. Viết ra ngoài quan trọng hơn nghĩ trong đầu vì nó buộc bạn phải làm rõ những chỗ bạn đang mơ hồ.

Nếu bạn không trả lời được câu nào trong năm câu — đó là lúc nên đi hỏi, không phải lúc bắt đầu code.

---

## Takeaway

Code chậm mà đúng hướng thì sau một tuần vẫn có một feature hoạt động. Code nhanh mà sai hướng thì sau một tuần có một đống code cần bỏ đi và làm lại. Kinh nghiệm không giúp gõ phím nhanh hơn — mà giúp giảm số lần phải làm lại.

---

*Bài tiếp theo: Over-engineering — cái bẫy mà sinh viên hay sa vào nhất.*
