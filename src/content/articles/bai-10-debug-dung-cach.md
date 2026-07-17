---
title: "Debug chậm không phải vì bạn dở — bạn đang debug sai cách"
description: "Debug không phải là đoán mò. Có một quy trình tư duy để tìm lỗi nhanh hơn — và hầu hết dev không ai dạy họ cách đó."
category: programming
pubDate: 2024-01-10
series: "Phần 1: Tư duy lập trình"
tags: ["debugging", "mindset", "productivity"]
---

Có một pattern rất quen thuộc: nhận được bug report, mở code, bắt đầu thêm `System.out.println` vào khắp nơi, chạy lại, xem output, thêm print nữa, chạy lại. Một tiếng sau vẫn chưa tìm ra.

Đây không phải vì bạn không đủ giỏi. Đây là vì bạn đang debug theo instinct thay vì theo method.

Người có kinh nghiệm debug nhanh không phải vì họ nhìn vào code và biết ngay vấn đề ở đâu. Họ nhanh vì họ có một approach có hệ thống — và approach đó dramatically reduce search space trước khi bắt đầu nhìn vào code cụ thể.

---

## Tại sao "thêm print và chạy lại" không scale

Approach này có một vấn đề cơ bản: nó là **local search** — bạn đang tìm kiếm từng điểm một mà không có hypothesis về bug ở đâu. Trong một codebase nhỏ, điều này có thể work. Trong một system phức tạp hơn, số điểm có thể là bug là vô hạn, và bạn có thể mất nhiều giờ chỉ để reach đúng chỗ.

Debug hiệu quả là về **narrowing the search space** trước tiên, rồi mới đi vào detail.

---

## Framework debug có hệ thống

**Bước 1: Reproduce trước tiên**

Trước khi làm bất cứ điều gì, đảm bảo bạn có thể reproduce bug một cách consistent. Bug không reproduce được là bug bạn chưa hiểu.

Hỏi: *Điều kiện để bug xảy ra là gì? Input cụ thể nào? State cụ thể nào? Concurrent conditions?*

Nếu bug chỉ xảy ra "đôi khi" — đó thường là signal của race condition hoặc timing issue. Đó là loại bug khác, cần approach khác.

**Bước 2: Đọc error message thật sự**

Nghe có vẻ hiển nhiên nhưng rất nhiều người bỏ qua bước này. Đọc toàn bộ stack trace, không chỉ dòng đầu tiên.

Stack trace nói cho bạn biết:
- Exception type — *loại* vấn đề là gì
- Line number — *nơi* exception được thrown
- Call stack — *path* dẫn đến đó

Với Spring Boot, exception thường được wrap nhiều lần. Hãy scroll xuống để tìm **"Caused by"** — đó mới là root cause.

**Bước 3: Form hypothesis trước khi nhìn vào code**

Đây là bước quan trọng nhất mà hầu hết mọi người bỏ qua.

Dựa trên error message và symptoms, hãy form một hypothesis về bug ở đâu và tại sao. Hypothesis không cần phải đúng — nhưng nó cho bạn một điểm để start và một cách để test.

*"Dựa vào NullPointerException ở dòng này, hypothesis của mình là `appointment.getPatient()` đang return null. Điều đó có thể xảy ra nếu appointment được load mà không fetch patient relationship."*

**Bước 4: Test hypothesis với minimum effort**

Cách nhanh nhất để test hypothesis là gì? Không phải thêm print mọi chỗ — mà là kiểm tra cụ thể hypothesis của bạn.

Nếu hypothesis là lazy loading issue, check JPA entity graph. Nếu hypothesis là transaction boundary issue, check `@Transactional` placement. Đừng mở rộng search trước khi test hypothesis hiện tại.

**Bước 5: Nếu hypothesis sai, update model của bạn**

Hypothesis sai không phải failure — nó là information. Bạn vừa loại được một khả năng. Update understanding của bạn về system và form hypothesis tiếp theo.

---

## Những bug pattern phổ biến trong Spring Boot

Biết những bug pattern phổ biến giúp bạn form hypothesis nhanh hơn:

**LazyInitializationException:** Entity được access ngoài transaction. Check xem `open-in-view` có false không, và liệu entity có được fetch trước khi transaction close không.

**@Transactional không hoạt động:** Gần như luôn là self-invocation — method A trong cùng class gọi method B có `@Transactional`. AOP proxy bị bypass. Solution: tách ra class riêng hoặc gọi qua `self` bean.

**N+1 query:** Bạn load một list entities rồi access lazy relationship trong loop. Dùng `@EntityGraph` hoặc `JOIN FETCH` để fetch relationship trong một query.

**OptimisticLockException:** Concurrent modification của cùng entity. Cần retry logic hoặc reconsider locking strategy.

**Transaction rollback nhưng side effect đã xảy ra:** Notification đã gửi, external API đã gọi — nhưng database transaction rolled back. Solution: dùng `@TransactionalEventListener(AFTER_COMMIT)` cho side effects.

---

## Debugger vs print statements

`System.out.println` debugging là fine cho quick checks. Nhưng khi bug phức tạp hơn, debugger cho bạn nhiều hơn:

- **Conditional breakpoints:** Chỉ stop khi condition thỏa mãn — ví dụ khi `appointmentId.equals(specificId)`
- **Expression evaluation:** Evaluate arbitrary expressions tại điểm dừng mà không cần add code
- **Step over/into:** Trace exactly cái gì xảy ra, từng dòng một
- **Watch variables:** Monitor giá trị thay đổi theo thời gian

Đặc biệt với concurrent bugs, debugger với conditional breakpoints là vũ khí mạnh hơn rất nhiều so với print statements.

---

## Rubber duck debugging

Đây là technique mình thấy actually work: giải thích bug cho một người khác (hoặc một con vịt cao su, hay thậm chí một AI). Không phải để người đó giải quyết — mà vì process giải thích buộc bạn phải articulate assumptions của bạn, và trong quá trình đó bạn thường tự tìm ra vấn đề.

*"Bug là: appointment booking thành công nhưng slot count không decrease. Mình nghĩ là Redis Lua script chạy sai. Nhưng khi mình check... hm, thật ra script chạy đúng nhưng mình đang call nó với wrong key format..."*

---

## Takeaway

Debug là một skill có thể học và improve — không phải intuition bẩm sinh. Framework cơ bản là: reproduce → đọc error message kỹ → form hypothesis → test hypothesis với minimum effort → iterate.

Khi bạn thấy mình đã debug hơn 30 phút mà không có progress, đó là dấu hiệu để step back và re-examine hypothesis của bạn từ đầu, không phải thêm nhiều print statement hơn.

---

*Kết thúc Phần 1. Phần tiếp theo: Clean Code thực chiến.*
