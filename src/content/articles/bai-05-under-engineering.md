---
title: "Under-engineering — cái bẫy ít ai nói đến"
description: "Không phải lúc nào đơn giản cũng là đúng. Under-engineering tạo ra technical debt ngay từ ngày đầu mà không ai nhận ra."
category: programming
pubDate: 2024-01-05
series: "Phần 1: Tư duy lập trình"
tags: ["mindset", "under-engineering", "technical-debt"]
---

Bài trước nói về over-engineering — thêm complexity không cần thiết. Bài này nói về mặt ngược lại, thứ ít được nhắc đến hơn nhưng gây ra rất nhiều đau đớn trong thực tế: **under-engineering** — viết code quá đơn giản đến mức không đủ để handle những thứ nó cần handle.

Nếu over-engineering là xây lâu đài khi chỉ cần một cái nhà, thì under-engineering là dựng lều khi cần một cái nhà.

---

## Under-engineering trông như thế nào

Dễ nhận ra nhất qua một số pattern phổ biến:

**Không validate input.** Nhận data từ client và tin tưởng hoàn toàn vào nó. Không check null, không check format, không check business constraints. Code chạy tốt với data hợp lệ, nhưng crash hoặc produce kết quả sai khi nhận data không hợp lệ — và client *luôn* gửi data không hợp lệ, dù vô tình hay cố ý.

**Không handle error.** Gọi external service mà không có timeout. Không handle trường hợp external service fail. Không có fallback. Khi Keycloak down 30 giây, toàn bộ flow authentication của app bạn cũng down theo.

**Không nghĩ đến concurrency.** Implement booking logic mà không nghĩ đến trường hợp hai request cùng đến một lúc. Code trông đúng khi chạy sequential, nhưng race condition xuất hiện khi có concurrent users.

**Hard-code mọi thứ.** Config production database URL thẳng trong code. Magic number nằm khắp nơi. Thay đổi một giá trị đòi hỏi sửa code, build lại, và deploy lại.

---

## Tại sao under-engineering xảy ra

Nguyên nhân phổ biến nhất là **"nó đủ dùng cho demo."** Khi làm đồ án, mục tiêu là demo cho thầy giáo thấy feature hoạt động. Không có real user, không có concurrent load, không có malicious input. Nên code minimal là đủ.

Vấn đề là thói quen này được mang thẳng vào môi trường production — nơi mà những thứ bạn assume sẽ không xảy ra thì đều *sẽ* xảy ra.

Nguyên nhân thứ hai là **deadline pressure**. "Cứ ship đi, sau sẽ fix" — câu này mình nghe rất nhiều. Đôi khi nó hợp lý, đặc biệt khi timeline thật sự tight và feature thật sự đơn giản. Nhưng "sau sẽ fix" rất hay trở thành "không bao giờ fix" vì luôn có thứ khác urgent hơn.

---

## Trường hợp thực tế — Payment trong HMS

Đây là một ví dụ điển hình của under-engineering gây ra hậu quả thật:

```java
// Under-engineered payment flow
@PostMapping("/payments/{id}/pay")
public ResponseEntity<Void> processPayment(@PathVariable UUID id) {
    Payment payment = paymentRepository.findById(id).orElseThrow();
    payment.setStatus(PaymentStatus.PAID);
    payment.setPaidAt(LocalDateTime.now());
    paymentRepository.save(payment);
    return ResponseEntity.ok().build();
}
```

Code này trông ổn. Nhưng nó thiếu một loạt thứ quan trọng:

- **Không check idempotency** — nếu client gọi hai lần (do network retry), payment sẽ được process hai lần
- **Không check current status** — payment đã PAID có thể bị PAID lại
- **Không có authorization check** — bất kỳ ai có payment ID đều có thể gọi endpoint này
- **Không trong transaction đúng cách** — nếu có side effects (update invoice, gửi notification), partial failure sẽ để lại inconsistent state

Không phải bạn cần implement tất cả mọi thứ ngay ngày đầu. Nhưng bạn cần *biết* những thứ này cần có và có plan để address chúng — không phải ignore hoàn toàn.

---

## Ranh giới giữa under và good enough

Đây là câu hỏi thực tế: làm sao biết khi nào "đơn giản" là under-engineering và khi nào nó là pragmatic?

Một framework để nghĩ về điều này: **hãy phân biệt giữa những thứ có thể fail và những thứ chắc chắn sẽ fail.**

Những thứ *có thể* fail nhưng unlikely: có thể accept là known risk và document lại.

Những thứ *chắc chắn* sẽ fail trong production: bắt buộc phải handle. Ví dụ:
- Users *sẽ* gửi invalid input
- Network calls *sẽ* timeout đôi khi  
- Concurrent users *sẽ* hit cùng một resource
- Client *sẽ* retry khi không nhận được response

Những thứ này không phải edge case — chúng là baseline assumption của bất kỳ production system nào.

---

## Checklist tối thiểu cho production-ready code

Với mỗi endpoint hoặc service bạn viết, hãy check:

**Input validation:** Data đến từ client có được validate trước khi process không? Null check, type check, business rule check?

**Authorization:** Ai được phép gọi cái này? Có check không?

**Error handling:** Nếu external dependency fail, code sẽ làm gì? Throw exception có nghĩa, hay crash với NullPointerException?

**Idempotency:** Nếu request được gọi hai lần, hệ thống có xử lý đúng không? (Quan trọng đặc biệt với write operations)

**Concurrency:** Nếu hai request cùng arrive trong milliseconds, có race condition không?

Không phải mọi endpoint đều cần xử lý phức tạp cho tất cả những điểm trên. Nhưng bạn cần có câu trả lời có ý thức cho từng điểm — không phải bỏ qua vì "chưa nghĩ tới."

---

## Takeaway

Over-engineering và under-engineering đều là biểu hiện của cùng một vấn đề: **thiếu judgment về bài toán thật sự cần gì.** Over-engineer thì bạn build nhiều hơn cần. Under-engineer thì bạn build ít hơn cần.

Sweet spot là viết code đủ robust để handle những thứ production *chắc chắn* sẽ throw at it, nhưng không thêm complexity cho những thứ chỉ *có thể* xảy ra trong tương lai xa.

---

*Bài tiếp theo: Technical debt không xấu — xấu là bạn không biết mình đang nợ ai.*
