---
title: "User không quan tâm code của mày — họ quan tâm trải nghiệm"
description: "Tao từng rất tự hào về một cái booking flow tao viết. Clean architecture đúng sách, separation of concerns rõ ràng, unit test coverage cao, zero redun..."
category: programming
pubDate: 2024-04-11
series: "Phần 11: Product Engineering"
---

Tao từng rất tự hào về một cái booking flow tao viết. Clean architecture đúng sách, separation of concerns rõ ràng, unit test coverage cao, zero redundant query. Senior review xong gật đầu: *"Code tốt."*

Rồi user test lần đầu. Họ bấm "Đặt lịch", chờ 3 giây, không thấy gì thay đổi, bấm lại, hệ thống báo lỗi slot đã được đặt. Họ không biết lần bấm đầu đã thành công.

Code tốt. Trải nghiệm tệ.

---

## Gap giữa code quality và user experience

Đây là một gap mà engineer hay bị mù. Chúng ta đánh giá công việc của mình theo tiêu chí kỹ thuật: correctness, performance, maintainability. Nhưng user đánh giá theo một tiêu chí duy nhất: *"Tao dùng được không, và dùng có dễ không?"*

Và hai thứ đó không tự động align với nhau.

Một service có response time 200ms là performance tốt theo metrics. Nhưng nếu sau khi gọi service đó, UI không show feedback gì — không spinner, không toast, không gì cả — user sẽ nghĩ ứng dụng bị đơ. Trải nghiệm tệ, dù backend hoàn toàn ổn.

Một form validation đúng hoàn toàn về logic. Nhưng nếu error message hiện sau khi user submit thay vì real-time khi họ đang điền, họ phải điền lại từ đầu. Không sai về kỹ thuật. Nhưng friction không cần thiết.

---

## Những thứ user thực sự cảm nhận

User không đọc source code. Họ cảm nhận thông qua một số điểm tiếp xúc rất cụ thể.

**Feedback ngay lập tức.** Mọi action của user cần có phản hồi trong vòng 100ms — không nhất thiết là kết quả, nhưng phải có *gì đó* cho họ biết hệ thống đã nhận được input. Button disabled + loading state sau khi click là thứ tối thiểu phải có. Không có cái này, user bấm nhiều lần → race condition → data inconsistency → bug report.

**Error message bằng ngôn ngữ của người dùng.** `AppointmentSlotUnavailableException` không phải error message. "Slot này vừa được đặt bởi người khác, vui lòng chọn slot khác" mới là error message. Kỹ thuật thuần túy dẫn đến cái trước. Nghĩ về user dẫn đến cái sau.

**Flow không bắt user phải nhớ.** Nếu user phải chọn doctor trước, sau đó chọn date, sau đó chọn slot — và slot không còn available thì yêu cầu họ quay lại chọn lại từ date — đó là flow hỏng. Không phải bug kỹ thuật, nhưng là bug trải nghiệm.

---

## Đây không phải trách nhiệm của designer

Tao thấy nhiều team có tư duy: UX là việc của designer, tao chỉ implement. Tư duy này có vấn đề không phải vì sai về phân công, mà vì nó tạo ra khoảng trống không ai chịu trách nhiệm.

Designer thiết kế flow lý tưởng. Nhưng engineer là người biết constraint thực sự của hệ thống — response time thật, failure case thật, edge case thật. Khi một API call có thể fail, ai quyết định user thấy gì? Khi session timeout, flow tiếp theo là gì? Designer thường không có đủ context để thiết kế hết những thứ này.

Engineer phải fill gap đó — không phải bằng cách redesign UI, mà bằng cách chủ động đặt câu hỏi: *"Trong trường hợp này user thấy gì?"* cho mọi failure path. Nếu câu trả lời là "không biết" hoặc "generic error page", đó là gap cần close trước khi ship.

---

## Một thói quen nhỏ, impact lớn

Trước khi open PR cho bất kỳ feature nào có UI, tao có một bước bắt buộc: tự tay chạy qua flow như một user không biết gì về implementation.

Không dùng dev tools để check response. Không mở console để xem log. Chỉ nhìn vào màn hình như user nhìn — và tự hỏi: *"Tao có biết hệ thống đang làm gì không? Tao có biết mình nên làm gì tiếp theo không?"*

Cái này tốn khoảng 5 phút. Số lần nó catch ra vấn đề trước khi QA thấy — nhiều hơn mày nghĩ.

---

## Takeaway

Code quality là thứ tao và teammate đánh giá. User experience là thứ user đánh giá. Và user không quan tâm tao viết code đẹp đến đâu nếu họ không biết cái button vừa làm gì. Hai tiêu chí đó không mâu thuẫn — nhưng chúng không tự động align. Phải chủ động làm cho chúng align.

---

*Bài tiếp theo: 90% dev giải sai vấn đề vì nhảy vào code quá sớm*
