---
title: "Dev làm task. Product engineer hỏi tại sao task này tồn tại"
description: "Developer implement ticket. Product-minded engineer hỏi: ticket này giải quyết vấn đề gì, có cách nào đơn giản hơn không, và đây có phải vấn đề đúng cần giải quyết không?"
category: programming
pubDate: 2024-04-01
series: "Phần 11: Tư duy sản phẩm"
tags: ["product-thinking", "mindset", "engineering"]
---

Có một kiểu sprint planning rất phổ biến: PM mở ticket lên, đọc description, assign cho dev, dev gật đầu, estimate, done. Hỏi dev đó hôm nay làm gì, họ sẽ trả lời: *"Tao đang làm ticket HMS-342 — thêm filter theo ngày vào màn hình appointment list."*

Hỏi tại sao filter đó cần tồn tại? Họ nhìn lại ticket. Không có gì ngoài dòng "Add date filter to appointment list screen." Họ nhún vai: *"PM bảo làm thì làm thôi."*

Đây là developer. Không sai. Nhưng đây không phải product engineer.

---

## Sự khác biệt không nằm ở seniority

Tao không nói đây là chuyện junior vs senior. Tao đã thấy senior dev 5 năm kinh nghiệm vẫn làm việc theo kiểu nhận ticket → implement → close. Và tao cũng thấy junior mới ra trường đã có thói quen hỏi *"feature này solve được vấn đề gì của user?"* trước khi viết dòng code đầu tiên.

Sự khác biệt nằm ở cách họ định nghĩa công việc của mình.

Dev thuần túy định nghĩa công việc theo task: *"Tao cần implement cái này."*
Product engineer định nghĩa công việc theo outcome: *"Cái này được implement để đạt được điều gì?"*

Nghe có vẻ philosophical. Nhưng hệ quả của sự khác biệt đó rất cụ thể.

---

## Tại sao câu hỏi "tại sao" quan trọng đến vậy

HMS có một lần tao nhớ mãi. Ticket yêu cầu thêm khả năng export danh sách bệnh nhân ra Excel. Estimate vài ngày, implement straightforward. Trước khi làm, ai đó hỏi: *"Export này dùng để làm gì?"*

Câu trả lời: admin cần gửi báo cáo hàng tháng cho ban giám đốc.

Câu hỏi tiếp theo: *"Họ cần format gì trong báo cáo đó?"*

Câu trả lời: tổng số lượt khám theo bác sĩ, theo khoa, tỷ lệ hoàn thành appointment.

Đó không phải là export danh sách bệnh nhân. Đó là report tổng hợp có aggregate data. Implement theo ticket gốc sẽ tạo ra một feature mà user phải tự tính tay trong Excel sau khi export — tức là giải đúng ticket, sai vấn đề.

Câu hỏi "tại sao" không mất nhiều thời gian. Nó tiết kiệm rất nhiều thời gian.

---

## Hỏi không phải để cản trở, mà để build đúng thứ

Có một nỗi sợ phổ biến: hỏi nhiều quá thì PM nghĩ mình khó tính, không hợp tác. Nỗi sợ này không hẳn vô lý — cách hỏi quan trọng không kém gì nội dung câu hỏi.

Hỏi kiểu này nghe như đang challenge: *"Tại sao cần làm feature này? Nó có thực sự cần thiết không?"*

Hỏi kiểu này nghe như đang partner: *"Mày có thể share thêm về use case cụ thể không? Tao muốn chắc là mình implement đúng theo cách sẽ solve được vấn đề đó."*

Cùng một intent, nhưng người nhận nghe khác hoàn toàn. Product engineer giỏi không hỏi để phán xét — họ hỏi để hiểu context đủ sâu để implement tốt hơn.

Và khi họ hiểu context, họ có thêm thứ quan trọng: khả năng push back đúng chỗ. Không phải push back vì không muốn làm, mà push back vì thấy một cách approach khác có thể đạt được outcome tốt hơn với ít effort hơn.

---

## Context thay đổi implementation decision

Cùng một feature, context khác nhau dẫn đến implementation khác nhau hoàn toàn.

Ví dụ: thêm sort theo tên bác sĩ vào danh sách appointment.

Nếu đây là feature cho receptionist — người dùng daily, list thường có 20-30 records — sort phía client là đủ, không cần touch backend.

Nếu đây là feature cho báo cáo admin — list có thể có hàng nghìn records, cần paginate — sort phải xuống database.

Nếu đây là feature mà user thực sự cần tìm appointment của một bác sĩ cụ thể — thì cái họ cần không phải sort, mà là search/filter theo tên bác sĩ.

Không hỏi context → implement một trong ba → may thì đúng, xui thì làm lại.

---

## Takeaway

Trước khi estimate bất kỳ ticket nào, hãy tự hỏi: *"Tao hiểu vấn đề mà feature này đang giải quyết chưa, hay tao chỉ đang hiểu implementation mà người khác đã quyết định?"* Hai thứ đó khác nhau — và biết cái nào mày đang thiếu là bước đầu tiên để chuyển từ dev làm task thành engineer giải vấn đề.

---

*Bài tiếp theo: User không quan tâm code của mày — họ quan tâm trải nghiệm*
