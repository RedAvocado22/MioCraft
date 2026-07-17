---
title: "Tư duy Trade-off — không có giải pháp hoàn hảo, chỉ có lựa chọn phù hợp"
description: "Mọi quyết định kỹ thuật đều có cái giá. Kinh nghiệm giúp nhìn rõ hơn thứ đang đánh đổi và lý do của lựa chọn đó."
category: programming
pubDate: 2024-01-08
series: "Phần 1: Tư duy lập trình"
tags: ["mindset", "trade-off", "decision-making"]
---

Một trong những câu hỏi mình thấy người mới hay hỏi nhất là: *"Cách nào tốt hơn?"*

SQL hay NoSQL? REST hay gRPC? Monolith hay microservices? Optimistic locking hay pessimistic locking? Cache ở đâu?

Câu trả lời của người có kinh nghiệm cho những câu hỏi này hầu như luôn là: *"Tùy."*

Không phải vì người có kinh nghiệm đang né tránh câu hỏi. Mà vì trong software engineering, hầu như không có giải pháp nào tốt hơn trong mọi trường hợp. Mọi decision đều là **trade-off** — bạn đổi thứ này lấy thứ kia, và câu hỏi thực sự là: với context cụ thể của bạn, cái gì đáng đổi hơn?

---

## Trade-off không phải compromise

Compromise là khi bạn không thể có A hay B nên lấy một thứ ở giữa, tệ hơn cả hai. Trade-off là khi bạn consciously chọn A biết rằng bạn từ bỏ B — vì với context của bạn, A quan trọng hơn B.

Đây là sự khác biệt quan trọng. Trade-off là quyết định có chủ đích, không phải quyết định bằng mặc định.

---

## Ví dụ thực tế — Locking strategy trong HMS

Trong HMS, khi implement appointment booking với slot limit, bạn phải quyết định locking strategy. Đây là một trade-off điển hình:

**Pessimistic locking:**

```java
@Lock(LockModeType.PESSIMISTIC_WRITE)
@Query("SELECT s FROM DoctorSchedule s WHERE s.id = :id")
Optional<DoctorSchedule> findByIdWithLock(@Param("id") UUID id);
```

*Ưu điểm:* Guarantee không có race condition. Simple to reason about — khi bạn hold lock, không ai khác có thể modify.

*Nhược điểm:* Throughput thấp hơn — requests phải queue. Deadlock risk nếu có multiple locks. Database lock là resource expensive.

**Optimistic locking:**

```java
@Version
private Long version;
// Hibernate sẽ throw OptimisticLockException nếu version conflict
```

*Ưu điểm:* High throughput — không có lock contention ở database. Tốt khi conflict rate thấp.

*Nhược điểm:* Cần retry logic ở application layer. User experience tệ hơn nếu conflict rate cao — request fail và phải retry.

**Redis Lua atomic script (cách HMS đang dùng):**

```lua
local current = redis.call('GET', KEYS[1])
if current and tonumber(current) >= tonumber(ARGV[1]) then
    return 0
end
redis.call('INCR', KEYS[1])
return 1
```

*Ưu điểm:* Atomic ở Redis level — fast, no database lock. Tốt cho high-concurrency booking.

*Nhược điểm:* Thêm infrastructure dependency (Redis). Consistency giữa Redis và database phải được manage carefully. Phức tạp hơn để reason about.

Không có cách nào "đúng" cho mọi trường hợp. HMS chọn Redis Lua vì appointment booking là high-contention operation và throughput quan trọng. Một hệ thống khác với load thấp hơn có thể chọn pessimistic locking vì simpler to implement và reason about.

---

## Framework để evaluate trade-off

Khi đứng trước một decision, hãy hỏi bốn câu:

**1. Context của bạn là gì?**
Scale, team size, existing infrastructure, timeline, business requirements. Trade-off đúng cho startup 5 người khác với trade-off đúng cho company 500 kỹ sư.

**2. Bạn đang optimize cho cái gì?**
Throughput? Consistency? Simplicity? Developer experience? Time-to-market? Hầu hết mọi technical decision đều involve ít nhất hai trong số những thứ này conflicting với nhau.

**3. Cái bạn từ bỏ có acceptable không?**
Bạn không thể có tất cả. Câu hỏi là liệu cái bạn phải từ bỏ có nằm trong acceptable range không. Nếu bạn chọn eventual consistency, bạn có thể accept user thấy stale data trong vài giây không? Với use case đó, điều đó có ổn không?

**4. Decision này có reversible không?**
Jeff Bezos phân chia decisions thành "two-way doors" (dễ đảo ngược) và "one-way doors" (khó đảo ngược). Với two-way door decisions — ship nhanh, learn, adjust. Với one-way door decisions — invest nhiều hơn vào analysis trước khi commit.

---

## Trade-off phổ biến bạn sẽ gặp

**Consistency vs Availability:** Khi network partition xảy ra, bạn ưu tiên cái nào? Trả về stale data (available) hay từ chối serve request (consistent)? Đây là CAP theorem, và trong thực tế, hầu hết systems chọn theo use case: financial data cần consistency hơn, social feed có thể accept eventual consistency.

**Performance vs Simplicity:** Cache giúp hệ thống nhanh hơn, nhưng introduce cache invalidation problem. Connection pool tốt hơn, nhưng cần configure đúng. Mỗi optimization đều có complexity cost.

**Flexibility vs Predictability:** Generic solutions flexible nhưng khó reason about. Specific solutions predictable nhưng cứng nhắc. Template Method pattern của HMS (BaseService) chọn một điểm cân bằng cụ thể ở đây.

**Speed vs Safety:** Ship nhanh để learn thì tốt, nhưng ship unsafe code trong production financial system thì không thể accept. Context quyết định mức độ acceptable risk.

---

## Cách document trade-off decision

Đây là thứ mà hầu hết mọi người bỏ qua: **document lý do tại sao bạn chọn solution này, không phải chỉ solution là gì.**

Một năm sau, người maintain code của bạn (có thể là chính bạn) sẽ không nhớ context lúc bạn đưa ra quyết định. Nếu bạn không document, họ sẽ không biết tại sao code lại như vậy, và có thể "fix" một thứ không cần fix — breaking một assumption quan trọng.

Một comment đơn giản là đủ:

```java
// Using Redis atomic Lua script instead of DB-level pessimistic locking
// because appointment booking is high-contention (multiple users booking
// simultaneously during popular hours). DB lock would cause significant
// throughput degradation. Trade-off: added Redis dependency and need to
// handle Redis-DB consistency carefully.
```

---

## Takeaway

Khi ai đó hỏi bạn "tại sao bạn chọn cách này?" — bạn cần có câu trả lời tốt hơn "vì nó hoạt động" hoặc "mình nghĩ nó tốt hơn." Bạn cần có thể giải thích: bạn đang optimize cho cái gì, bạn đang từ bỏ cái gì, và tại sao với context cụ thể này, đó là sự đánh đổi đúng.

Đó là sự khác biệt giữa người implement một solution và người *own* một decision.

---

*Bài tiếp theo: Complexity không chứng minh bạn giỏi — đơn giản mới chứng minh bạn hiểu sâu.*
