---
title: "90% dev giải sai vấn đề vì nhảy vào code quá sớm"
description: "\"Chúng ta cần cache\" — thực ra là query đang thiếu index. \"Cần thêm field vào DB\" — thực ra là UI đang hiển thị sai. Hiểu đúng vấn đề trước khi giải nó."
category: programming
pubDate: 2024-04-03
series: "Phần 11: Tư duy sản phẩm"
tags: ["product-thinking", "problem-solving", "mindset"]
---

Có một triệu chứng rất đặc trưng của developer mới vào nghề: họ mở IDE trước khi hiểu vấn đề xong. Không phải vì lười biếng hay thiếu cẩn thận — mà vì với họ, code *là* cách suy nghĩ. Gõ ra thì mới thấy rõ.

Cái này không hoàn toàn sai. Nhưng nó có một side effect nguy hiểm: bạn bắt đầu giải một bài toán trước khi chắc chắn đó là đúng bài toán cần giải.

---

## Symptom phổ biến nhất

Bug report từ QA: *"Bệnh nhân không book được lịch vào buổi chiều."*

Dev nhận xong, check code, thấy có một chỗ filter schedule theo `morning/afternoon` enum, suspect đó là vấn đề, fix, test pass, close ticket.

QA mở lại: *"Vẫn không được."*

Dev check lại, đào sâu hơn, tìm thêm một chỗ nữa có logic tương tự. Fix. Test. Close.

QA mở lại lần ba: *"Vẫn không."*

Lần này dev ngồi lại hỏi user thật sự làm gì khi reproduce. Hóa ra: họ đang book lịch cho một bác sĩ cụ thể, người này không có schedule buổi chiều nào được tạo trong hệ thống. Không có bug. Data thiếu.

Ba lần fix sai, một lần hỏi đúng.

---

## Vấn đề với "giải pháp hiển nhiên"

Não người rất giỏi pattern matching. Khi thấy một symptom, nó lập tức tìm solution phù hợp với pattern tương tự từ kinh nghiệm trước. Với dev, pattern quen thuộc nhất là "bug trong code" → "fix code". Nên khi có vấn đề, bước đầu tiên gần như tự động là nhìn vào code.

Nhưng symptom và root cause thường không nằm ở cùng một chỗ.

User thấy chậm → không hẳn là code chậm, có thể là N+1 query, có thể là thiếu index, có thể là network, có thể là họ đang dùng wifi yếu.

User thấy data sai → không hẳn là logic sai, có thể là data được seeded sai, có thể là cache đang serve stale data, có thể là múi giờ.

User không làm được một flow → không hẳn là bug, có thể là UX confusing, có thể là missing permission, có thể là prerequisite step chưa được làm.

Nhảy vào code ngay tức là chọn một trong những hypothesis đó mà không verify. May thì đúng. Sai thì tốn thời gian cho cả team.

---

## Framework đơn giản: Understand trước, Implement sau

Không cần process phức tạp. Chỉ cần hai bước bắt buộc trước khi viết dòng code đầu tiên:

**Bước 1 — Reproduce được vấn đề.** Không phải nghe mô tả, không phải đọc ticket. Tự tay reproduce. Nếu không reproduce được, bạn chưa hiểu vấn đề. Nếu reproduce được, bạn đã có thêm thông tin: chính xác điều kiện nào dẫn đến vấn đề đó.

**Bước 2 — Đặt ra ít nhất 3 hypothesis về root cause.** Không phải một. Một hypothesis duy nhất là confirmation bias — bạn đang tìm bằng chứng ủng hộ thứ bạn đã nghĩ, không phải tìm sự thật. Ba hypothesis buộc bạn phải nghĩ rộng hơn, và thường một trong hai cái còn lại mới là thứ đúng.

Sau hai bước đó, mới bắt đầu investigate — theo thứ tự từ hypothesis dễ verify nhất đến khó nhất.

---

## Giải pháp không phải lúc nào cũng là code

Đây là điều quan trọng nhất product engineer hiểu mà pure dev hay bỏ qua: **không phải mọi vấn đề đều cần code để giải quyết.**

Đôi khi giải pháp là một dòng SQL để fix data production.
Đôi khi là một email hướng dẫn user làm đúng flow.
Đôi khi là một config change.
Đôi khi là "đây không phải bug, đây là expected behavior, cần update documentation."

Những giải pháp này không cần PR, không cần code review, không cần deploy. Nếu bạn nhảy vào code ngay, bạn sẽ miss hết những giải pháp đơn giản hơn này — và tạo ra complexity không cần thiết cho một vấn đề vốn dĩ không cần complexity.

---

## Takeaway

Lần tới khi nhận một ticket bug hoặc một feature request, hãy thử đặt quy tắc cho bản thân: không được mở IDE trong 15 phút đầu. Chỉ được đọc, hỏi, và viết ra những gì bạn đã hiểu về vấn đề. Nếu sau 15 phút bạn không viết được một câu mô tả rõ ràng vấn đề là gì — bạn chưa sẵn sàng để giải nó.

---

*Bài tiếp theo: Làm ít hơn nhưng đúng hơn — MVP thinking*
