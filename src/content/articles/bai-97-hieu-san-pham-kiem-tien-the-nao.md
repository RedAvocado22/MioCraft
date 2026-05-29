---
title: "Hiểu sản phẩm kiếm tiền thế nào để viết code tốt hơn"
description: "Câu hỏi này nghe có vẻ lạ khi đặt ra cho engineer: *Sản phẩm mày đang build kiếm tiền bằng cách nào?*"
category: programming
pubDate: 2024-04-16
series: "Phần 11: Product Engineering"
---

Câu hỏi này nghe có vẻ lạ khi đặt ra cho engineer: *"Sản phẩm mày đang build kiếm tiền bằng cách nào?"*

Phần lớn dev không biết câu trả lời. Không phải vì họ không thông minh — mà vì không ai thấy nó liên quan đến công việc hàng ngày. Tao implement feature, tao fix bug, tao maintain service. Chuyện tiền bạc là của PM và business.

Nhưng nếu tao không biết sản phẩm kiếm tiền từ đâu, tao không biết cái gì thật sự quan trọng. Và không biết cái gì quan trọng, mọi decision đều có weight như nhau — điều này không đúng.

---

## Business model ảnh hưởng đến technical priority

HMS là hệ thống quản lý bệnh viện. Revenue chính đến từ phí khám — mỗi completed appointment là một transaction. Từ đó, cái quan trọng nhất với business là: appointment được đặt thành công, patient đến, payment được ghi nhận.

Nhìn từ góc đó, một số technical decision trở nên rõ ràng hơn nhiều:

Tại sao booking flow cần atomic operation với Redis Lua? Vì nếu double-booking xảy ra, business mất tiền — patient không đến, trust giảm. Cost cao.

Tại sao payment service cần idempotency key? Vì charge nhầm hai lần là scandal với user, và chargeback tốn tiền với payment provider. Cost rất cao.

Tại sao notification feature quan trọng? Vì no-show rate ảnh hưởng trực tiếp đến revenue per slot.

Và ngược lại — tại sao một số feature fancy nhưng không liên quan đến booking/payment/schedule core không được prioritize cao? Vì chúng không touch critical path của revenue.

---

## "Câu hỏi của engineer" vs "câu hỏi của product engineer"

Dev thuần túy nhìn feature request và hỏi: *"Implement cái này tốn bao lâu?"*

Product engineer nhìn cùng feature request và hỏi thêm: *"Feature này ảnh hưởng đến phần nào của business? Nếu nó fail lúc production, cost là bao nhiêu?"*

Hai câu hỏi đó dẫn đến implementation decision rất khác nhau.

Một feature trong booking flow fail? Cần circuit breaker, cần fallback, cần alert ngay lập tức, cần on-call rotation. SLA phải cao.

Một feature trong reporting dashboard fail? User thấy số cũ hơn thực tế vài giờ. Annoying, nhưng không phải emergency. Acceptable downtime cao hơn, on-call không cần, stale cache là chấp nhận được.

Cùng một mức engineering effort bỏ vào hai chỗ đó có ROI khác nhau hoàn toàn. Product engineer biết điều này. Dev thuần túy thường không.

---

## Không phải để mày lo chuyện business

Tao không nói mày cần trở thành business analyst hay learn finance. Tao nói: hiểu enough để prioritize đúng.

Đủ để biết cái nào là critical path, cái nào là nice-to-have.
Đủ để biết khi nào cần over-engineer (vì cost of failure cao), khi nào có thể under-engineer (vì feature không quan trọng với business outcome).
Đủ để trong sprint planning, khi có trade-off, mày có thêm một dimension để ra quyết định.

Câu hỏi đơn giản nhất để bắt đầu: hỏi PM hoặc lead *"Flow nào trong hệ thống mà nếu nó down 1 tiếng thì business thiệt nhất?"* Câu trả lời đó là map của cái mày cần bảo vệ nhất.

---

## Kết thúc series — và cái thật sự bắt đầu

Đây là bài cuối của *Code Sống Sót*.

Nhưng thật ra series này không có điểm kết thúc — vì những thứ được nói trong 97 bài là thứ mày sẽ học lại nhiều lần, ở nhiều level khác nhau, trong nhiều project khác nhau. Mỗi lần đọc lại một bài, mày sẽ hiểu khác đi vì context của mày đã khác.

Thứ tao muốn mày mang theo không phải là checklist hay framework. Mà là một thói quen: **hỏi tại sao trước khi hỏi như thế nào.**

Tại sao feature này tồn tại. Tại sao cần design pattern này ở đây. Tại sao trade-off này được chọn. Tại sao đây là vấn đề quan trọng cần solve.

Dev giỏi biết *how*. Engineer giỏi biết *why*.

---

## Takeaway

Bỏ ra 30 phút để hiểu business model của sản phẩm mày đang build. Hỏi PM: revenue đến từ đâu, user nào là user quan trọng nhất, flow nào là flow không được phép chết. Những câu trả lời đó sẽ reshape cách mày prioritize technical work — và làm cho mày trở thành engineer được trust hơn, không phải chỉ dev implement ticket tốt hơn.

---

*Kết thúc Series: Code Sống Sót — Từ Project Sinh Viên Đến Production-Ready*
