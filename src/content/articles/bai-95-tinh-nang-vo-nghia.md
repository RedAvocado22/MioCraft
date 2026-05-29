---
title: "Tính năng không tạo giá trị = tính năng vô nghĩa"
description: "Mỗi tính năng là gánh nặng: cần maintain, cần test, cần document, cần support. Tính năng tốt nhất đôi khi là tính năng bạn quyết định không build."
category: programming
pubDate: 2024-04-05
series: "Phần 11: Tư duy sản phẩm"
tags: ["product-thinking", "feature-planning", "engineering"]
---

Một sự thật không ai nói thẳng trong sprint planning: phần lớn feature được build không được dùng đến mức tạo ra value đáng kể.

Không phải vì team làm sai. Không phải vì engineer code tệ. Mà vì assumption gốc rễ — *"user cần cái này"* — chưa được validate trước khi build.

---

## Feature cemetery

Có một khái niệm trong product mà tao thấy rất đúng: *feature cemetery* — nghĩa địa của những feature được ship nhưng không ai dùng. Mọi sản phẩm đều có nó. Nó không hiện ra trên màn hình, nhưng nó sống trong codebase dưới dạng dead code, orphan API, UI component không ai hover vào, notification type không ai click.

Và mỗi feature trong cemetery đó đều có cost thật sự: test phải cover nó, upgrade dependency phải không break nó, onboarding member mới phải giải thích nó tồn tại để làm gì. Code không dùng không phải code vô hại — nó là weight mày phải carry mãi.

---

## Làm sao biết feature có tạo giá trị không

Trước khi build bất kỳ feature nào, cần trả lời được ba câu:

**Câu 1: Feature này giải quyết vấn đề gì của ai?**

Phải cụ thể. "Giúp user dễ dùng hơn" không phải câu trả lời. "Receptionist hiện phải gọi điện confirm lịch thủ công cho 30-40 bệnh nhân mỗi ngày, feature này tự động hóa bước đó" mới là câu trả lời.

Nếu không trả lời được câu này cụ thể — feature chưa sẵn sàng để build.

**Câu 2: Nếu feature này không tồn tại, user sẽ làm gì?**

Câu hỏi này rất revealing. Nếu câu trả lời là "họ không làm gì cả vì không ai đang làm việc đó" — thì feature đang tạo ra behavior mới, chưa chắc behavior đó là thứ user muốn. Nếu câu trả lời là "họ đang làm thủ công bằng cách X" — thì đó là pain point thật, và feature có cơ sở để solve nó.

**Câu 3: Mày sẽ đo thành công của feature này bằng cái gì?**

Metric không cần phức tạp. Nhưng cần tồn tại. Nếu không define được success metric trước khi build, mày sẽ không biết feature có hoạt động không — và mày sẽ không bao giờ có lý do để remove nó dù nó không tạo ra gì.

---

## Khi feature request đến từ senior hoặc stakeholder

Tao hiểu đây là chỗ nhạy cảm. Không phải lúc nào cũng dễ push back lên một feature mà CEO hoặc CTO muốn làm.

Nhưng push back không có nghĩa là từ chối. Nó có nghĩa là hỏi đúng câu hỏi: *"Để mình đảm bảo implement đúng, anh/chị có thể share thêm về use case cụ thể không? Mình muốn hiểu rõ problem trước khi lên solution."*

Câu hỏi đó không challenge authority. Nó show sự professional. Và nếu stakeholder không trả lời được — đó là signal quan trọng về mức độ nghiêm túc của request.

---

## Đôi khi đúng hơn là build less

HMS có một giai đoạn tao nhớ: PM muốn thêm dashboard analytics phức tạp cho admin — biểu đồ, filter, export, so sánh theo thời kỳ. Estimate hai tháng.

Trước khi kick off, ai đó hỏi admin hiện tại đang track gì, track bằng cách nào. Câu trả lời: Google Sheet, cập nhật thủ công mỗi tuần, chỉ xem được 3-4 số chính.

Giải pháp thật sự: một màn hình đơn giản show 4 số đó, tự động tính từ data hệ thống. Một sprint, không phải hai tháng.

Admin dùng ngay lập tức. Analytics dashboard phức tạp nếu build sẽ ngồi trong cemetery vì admin không có nhu cầu phức tạp như vậy.

---

## Takeaway

Một feature chỉ tồn tại nếu nó làm cho ai đó làm được gì đó quan trọng với họ dễ hơn, nhanh hơn, hoặc đáng tin hơn. Không đáp ứng được ít nhất một trong ba thứ đó — feature không có lý do để tồn tại, dù implement nó có clean đến đâu.

---

*Bài tiếp theo: Technical debt không xấu — xấu là không biết dùng nó*
