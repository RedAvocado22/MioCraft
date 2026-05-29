---
title: "Technical debt không xấu — xấu là mày không biết mình đang nợ ai"
description: "Technical debt là công cụ, không phải tội lỗi. Vấn đề là khi bạn nợ mà không biết mình đang nợ — đến lúc trả giá mới hay."
category: programming
pubDate: 2024-01-06
series: "Phần 1: Tư duy lập trình"
tags: ["mindset", "technical-debt", "trade-off"]
---

"Technical debt" là một trong những cụm từ bị dùng sai nhiều nhất trong ngành.

Nhiều người dùng nó như một cách nói lịch sự hơn cho "code xấu" — như thể mọi shortcut, mọi quick fix, mọi đoạn code không hoàn hảo đều là technical debt cần phải trả. Cách hiểu này dẫn đến một trong hai thái cực: hoặc cố gắng có zero debt (không thực tế), hoặc dùng "đó là technical debt" như một cái cớ để không bao giờ cải thiện bất cứ thứ gì.

Cả hai đều sai.

---

## Technical debt thực sự là gì

Khái niệm technical debt được Ward Cunningham đưa ra — và ông dùng từ "debt" rất có chủ đích, vì nó mang đầy đủ ý nghĩa tài chính: **debt không phải xấu, debt là một công cụ.**

Khi mày vay tiền để mua nhà, mày không có đủ tiền mặt ngay lúc đó, nhưng mày có thể move vào nhà ngay hôm nay và trả dần theo thời gian. Debt cho phép mày nhận được value ngay bây giờ thay vì chờ đến khi có đủ điều kiện lý tưởng — điều đó có thể không bao giờ đến.

Technical debt hoạt động tương tự. Đôi khi mày chọn một solution không hoàn hảo vì:
- Timeline tight và cần ship
- Chưa có đủ information để thiết kế đúng ngay bây giờ
- ROI của solution hoàn hảo không đủ cao so với cost implement nó lúc này

Đó là những quyết định hợp lý. Vấn đề xuất hiện khi mày **không biết mình đang nợ gì**, và do đó không có kế hoạch để trả.

---

## Hai loại technical debt hoàn toàn khác nhau

**Deliberate debt — debt có chủ đích:**

Mày biết solution hiện tại không hoàn hảo. Mày chọn nó có ý thức vì một lý do cụ thể. Mày document lại decision đó và có plan để address sau.

Ví dụ: trong HMS, khi Keycloak revert fail, mày hiện tại chỉ log CRITICAL và không có email alert. Đây là known gap — được document trong project, có plan address sau phase 5. Đó là deliberate debt. Mày biết nó tồn tại, mày biết nó ở đâu, và mày có kế hoạch trả.

**Accidental debt — debt vô tình:**

Mày không biết mày đang nợ. Code được viết theo cách "trông có vẻ đúng" nhưng có những vấn đề tiềm ẩn mà mày chưa nhận ra. Không có document, không có plan, và thường không có cả awareness.

Ví dụ phổ biến: viết query mà không nghĩ đến index, viết transaction boundary không đúng, hardcode config mà không biết đó là vấn đề. Những thứ này âm thầm tích tụ cho đến khi hệ thống scale lên và mọi thứ bắt đầu fail theo cách không ai giải thích được.

Accidental debt là loại nguy hiểm. Deliberate debt là công cụ.

---

## "Interest" của technical debt

Giống như financial debt, technical debt tích lũy interest theo thời gian.

Interest ở đây nghĩa là: càng để lâu, càng khó trả. Một đoạn code viết sai cách hôm nay, nếu không sửa, sẽ được build thêm logic lên trên. Rồi có thêm feature phụ thuộc vào nó. Rồi có thêm integration. Đến lúc mày nhận ra vấn đề, cái bạn cần sửa không còn là một đoạn code nữa — nó là một hệ sinh thái phụ thuộc nhau mà không ai dám chạm vào.

Đây là lý do "trả debt sớm" thường tốt hơn "để sau." Không phải vì hoàn hảo là mục tiêu, mà vì interest tích lũy.

---

## Làm sao manage technical debt đúng cách

**Bước 1: Nhận biết và đặt tên.**

Khi mày viết một shortcut hoặc một solution "tạm thời," hãy explicit về điều đó. Comment trong code, note trong ticket, hoặc document trong architecture decision record. Đừng chỉ viết code và hy vọng mày sẽ nhớ.

```java
// TODO: [TECH-DEBT] Current implementation loads all schedules into memory
// and filters in application layer. Acceptable for current load (<100 doctors)
// but needs to move to DB-level filtering before go-live.
// Tracked in: HMS-234
```

**Bước 2: Prioritize dựa trên interest rate.**

Không phải mọi debt đều cần trả ngay. Ưu tiên những thứ:
- Đang ảnh hưởng đến reliability hoặc security *ngay bây giờ*
- Sẽ trở nên exponentially khó hơn để fix nếu để lâu hơn
- Đang block team velocity — mọi người phải work around nó

**Bước 3: Trả debt định kỳ.**

Một số team dành 20% sprint capacity cho debt repayment. Số cụ thể không quan trọng bằng việc có một commitment rõ ràng — không phải "sẽ fix sau" mà là "sẽ fix trong sprint X."

---

## Dấu hiệu debt đang out of control

- Mọi change dù nhỏ đều mất nhiều thời gian hơn dự kiến
- Team ngại chạm vào một số phần của codebase
- Bug fix ở một chỗ thường gây ra bug ở chỗ khác
- Không ai trong team hiểu đầy đủ toàn bộ hệ thống
- Onboarding người mới mất quá lâu

Nếu mày nhận ra những dấu hiệu này, đó không phải lúc để panic — đó là lúc để có một cuộc trò chuyện thẳng thắn với team về debt và bắt đầu có kế hoạch.

---

## Takeaway

Technical debt không phải kẻ thù cần tiêu diệt. Nó là một công cụ có thể dùng đúng cách hoặc sai cách. Dùng đúng cách: mày chủ động chọn shortcuts khi cần, document rõ ràng, và có plan trả. Dùng sai cách: để debt tích lũy mà không biết, không track, và không có kế hoạch — cho đến khi nó trở thành vấn đề của người khác.

Câu hỏi không phải "mày có technical debt không?" — mày chắc chắn có. Câu hỏi là "mày có biết mày đang nợ ai không?"

---

*Bài tiếp theo: Tư duy Failure-first — thiết kế để không sập, không phải để chạy.*
