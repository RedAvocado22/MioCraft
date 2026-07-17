---
title: "Technical debt không xấu — xấu là không biết dùng nó"
description: "P01/Bài 06 trong series này nói về technical debt từ góc độ kỹ thuật — bạn đang nợ ai, nợ cái gì. Bài này nói về nó từ góc độ product: khi nào nên chủ động..."
category: programming
pubDate: 2024-04-15
series: "Phần 11: Tư duy sản phẩm"
---

P01/Bài 06 trong series này nói về technical debt từ góc độ kỹ thuật — bạn đang nợ ai, nợ cái gì. Bài này nói về nó từ góc độ product: khi nào nên chủ động vay nợ, và khi nào cái gọi là “debt” thực ra là quyết định đúng đắn bị gán nhãn sai.

---

## Debt không phải lúc nào cũng là tai nạn

Có hai loại technical debt hoàn toàn khác nhau mà bị đặt chung một tên.

**Loại 1 — Reckless debt:** viết code nhanh bừa vì lười, vì không biết tốt hơn, vì không quan tâm. Cái này thật sự là nợ xấu — không có plan để trả, không có lý do rõ ràng để vay.

**Loại 2 — Deliberate debt:** chủ động chọn solution đơn giản hơn bây giờ, biết rõ trade-off, có plan khi nào sẽ làm đúng. Đây không phải coding kém. Đây là business decision.

Ví dụ thực tế: trong HMS lúc đầu, notification được gửi synchronously trong request. Bạn biết đây là sai về kiến trúc — nên dùng queue. Nhưng lúc đó team đang validate xem notification flow có work không trước, queue sẽ thêm complexity và thời gian setup. Quyết định: sync trước, refactor sang async khi volume justify. Document lại. Move on.

Đó là deliberate debt. Nó có expiry date và lý do tồn tại.

---

## Debt là leverage — nếu bạn kiểm soát được nó

Trong tài chính, vay tiền để đầu tư không phải điều xấu — miễn là return cao hơn cost of debt. Tương tự, technical debt là leverage khi nó cho phép bạn ship nhanh hơn để validate, học faster, và đưa ra quyết định kiến trúc dựa trên reality thay vì assumption.

Vấn đề không phải là debt tồn tại. Vấn đề là debt invisible — không ai biết nó đang ở đâu, tốn bao nhiêu, khi nào cần trả.

Debt trở thành gánh nặng khi:
- Không được document: team mới join không biết "tại sao lại như thế này"
- Không có plan trả: cứ để đó vô thời hạn
- Tích lũy quá mức: mỗi sprint đều tạo ra thêm mà không trả cái cũ
- Dependency lên nhau: một chỗ debt khiến chỗ khác cũng phải làm workaround

---

## Công cụ đơn giản nhất: debt log

Mình không biết team nào có process hoàn hảo cho cái này, nhưng cái tối thiểu là một chỗ để track deliberate debt. Không cần tool phức tạp. Một file markdown, một Jira label, một Notion page — miễn là có.

Mỗi entry cần trả lời được: đây là gì, tại sao chọn làm vậy, khi nào sẽ revisit, ai biết về nó.

```
## [2024-03] Sync notification trong AppointmentService
- What: Notification gửi sync thay vì queue
- Why: Team đang validate flow, queue setup tốn thêm 3 ngày
- Revisit when: Khi volume > 100 appointment/day hoặc sau khi flow stable
- Owner: @whoever implemented it
```

Một entry như thế tốn 5 phút viết. Nó tiết kiệm hàng giờ cho người maintain sau.

---

## Khi nào phải trả

Debt cần được trả khi cost of carrying nó lớn hơn cost of fixing nó. Cụ thể là:

**Khi nó block feature mới.** Nếu mỗi lần thêm feature mới phải work around một đống legacy decision cũ, đó là signal debt đang cost nhiều hơn được.

**Khi nó gây bug liên tục.** Nếu cùng một vùng code liên tục xuất hiện trong bug report, đó không phải là dev viết bug — đó là design đang đòi nợ.

**Khi team mới không thể onboard fast.** Nếu cần giải thích nhiều hơn một ngày về "tại sao code làm thế" thay vì "code làm gì" — complexity đang leak từ tech sang human cost.

Không nhất thiết phải có sprint dedicated cho "tech debt." Quy tắc đơn giản hơn: mỗi sprint, nếu bạn đang làm việc trong một vùng code có debt — fix debt đó trước khi add feature mới. Boy scout rule: leave the campsite cleaner than you found it.

---

## Takeaway

Câu hỏi không phải "có nên có technical debt không" — câu trả lời gần như luôn là có, vì build product là series of trade-off. Câu hỏi đúng là: *"Mình có đang kiểm soát debt của mình không, hay nó đang kiểm soát mình?"*

---

*Bài tiếp theo: Hiểu sản phẩm kiếm tiền thế nào để viết code tốt hơn*
