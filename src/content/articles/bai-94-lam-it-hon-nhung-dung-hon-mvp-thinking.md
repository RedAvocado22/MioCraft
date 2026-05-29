---
title: "Làm ít hơn nhưng đúng hơn — MVP thinking"
description: "Khi PM đề xuất tính năng đặt lịch tái khám tự động, có hai kiểu phản ứng thường thấy."
category: programming
pubDate: 2024-04-13
series: "Phần 11: Product Engineering"
---

Khi PM đề xuất tính năng đặt lịch tái khám tự động, có hai kiểu phản ứng thường thấy.

Dev kiểu một nghe xong bắt đầu design: cần một scheduled job chạy mỗi đêm, cần notify patient qua SMS và email, cần cho phép patient confirm hoặc reschedule từ link trong email, cần dashboard cho doctor review lịch tái khám, cần...

Dev kiểu hai hỏi một câu: *"Mục tiêu của tính năng này là gì — giảm no-show, hay tăng retention, hay cái gì khác?"*

Câu trả lời: giảm no-show. Bệnh nhân hay quên lịch tái khám.

Dev kiểu hai tiếp: *"Vậy version đơn giản nhất để test xem notify trước 24h có giảm no-show không là gì?"*

Câu trả lời: một cái job gửi SMS nhắc lịch. Không cần confirm link, không cần dashboard, không cần reschedule flow.

Hai tuần thay vì hai tháng. Và nếu notify không giảm no-show — vì có thể vấn đề thật là bệnh nhân không có tiền khám lại, không phải quên — thì đã tiết kiệm được sáu tuần dev time.

---

## MVP không phải là làm nhanh và ẩu

Đây là hiểu lầm phổ biến nhất. MVP — Minimum Viable Product — không có nghĩa là làm tệ đi để ship nhanh. Nó có nghĩa là tìm ra cái nhỏ nhất có thể validate được assumption quan trọng nhất.

Assumption quan trọng nhất thường là: *"Người dùng có cần thứ này không?"* hoặc *"Cái này có solve được vấn đề không?"*

Nếu chưa validate được assumption đó, mọi thứ built thêm lên trên đó đều là risk. Có thể đúng, có thể sai — nhưng mày đang bet mà không có data.

MVP là cách để lấy data trước khi bet lớn.

---

## Scope creep đến từ đâu

Tao thấy một pattern lặp đi lặp lại: feature bắt đầu nhỏ, nhưng trong quá trình discuss và estimate, nó lớn dần.

Ai đó thêm: *"Nhân tiện nên thêm luôn option X để sau khỏi làm lại."*
Ai đó khác thêm: *"Nếu làm X thì nên làm Y luôn để đồng bộ."*
Rồi: *"Nhưng nếu có Y thì phải handle case Z."*

Lý do nghe đều hợp lý. Nhưng kết quả là một scope gấp ba, timeline gấp đôi, và complexity tăng theo cấp số nhân.

Thứ mày cần là một câu hỏi filter đơn giản cho mỗi thứ được đề xuất thêm vào: *"Nếu không có cái này, feature core có fail không?"* Nếu không — nó là nice-to-have, không phải must-have, và nó thuộc về sprint sau sau khi validate xong version đơn giản.

---

## Viết code ít hơn không phải là làm việc ít hơn

Một trong những skill khó nhất của product engineer là biết không viết gì. Không phải vì lười — mà vì viết code ít hơn đòi hỏi suy nghĩ nhiều hơn để tìm ra cái minimal thực sự cần thiết.

Trong HMS, tao có một lần phải implement filter appointment theo nhiều criteria cùng lúc — status, doctor, date range, department. Version đầu tao design một query builder dynamic với nhiều combination. Rồi nhìn lại usage thực tế: 80% filter usage chỉ dùng date range + status. Hai cái còn lại dùng rất ít.

Version ship: filter theo date range và status, hardcode rõ ràng, không có dynamic query builder. Thêm sau nếu cần. Không thêm nếu không cần.

Code ít hơn. Bug ít hơn. Maintain dễ hơn. User không thấy khác biệt.

---

## MVP không có nghĩa là không nghĩ đến tương lai

Một lo ngại thường gặp: *"Nếu làm MVP thì sau có scale được không?"*

Câu trả lời đúng: tùy. Có những architectural decision mà nếu làm sai từ đầu thì refactor sau rất đau — và những thứ đó cần được làm đúng ngay từ MVP. Nhưng có rất nhiều thứ khác có thể được defer mà không tạo ra tech debt thật sự.

Quy tắc đơn giản: nếu thay đổi sau này cần refactor data model hoặc API contract — consider làm đúng ngay. Nếu thay đổi sau chỉ cần thêm code mới mà không phá code cũ — defer được.

Notify flow ở trên: thêm confirm link sau không phá gì cả. Nhưng nếu chọn sai data model để store lịch tái khám, refactor sau rất đau. Hai decision level khác nhau.

---

## Takeaway

Với mỗi feature mới, hãy hỏi: *"Version nhỏ nhất có thể cho tao biết feature này có đáng build full không là gì?"* Đó là câu hỏi của product engineer — người biết rằng build đúng thứ quan trọng hơn build thứ đúng.

---

*Bài tiếp theo: Tính năng không tạo giá trị = tính năng vô nghĩa*
