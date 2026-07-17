---
title: "Isolation Levels — bốn cấp độ và khi nào mày cần cái nào"
description: "Read Uncommitted, Read Committed, Repeatable Read, Serializable — mỗi level là một trade-off giữa consistency và performance. Chọn sai là data corruption hoặc bottleneck."
category: system-design
pubDate: 2024-02-21
series: "Phần 6: Database"
tags: ["database", "transactions", "isolation"]
---

Hai transaction chạy đồng thời. Cái nào "isolated" được như thế nào — tức là transaction này nhìn thấy bao nhiêu data thay đổi từ transaction kia — đó là **Isolation Level**.

MySQL có 4 levels: READ UNCOMMITTED, READ COMMITTED, REPEATABLE READ, SERIALIZABLE. Mỗi level cho phép một loại "anomaly" khác nhau. Mày cần hiểu cái nào để lựa chọn đúng cho HMS.

---

## Bốn loại anomaly

Trước hết, cái gì là "sai" khi concurrent transactions chạy?

**Dirty Read** — Transaction A đọc data mà transaction B vừa update nhưng chưa commit. Nếu B rollback, A thấy data "bẩn" (không tồn tại).

**Non-repeatable Read** — Transaction A đọc cùng row hai lần, giữa hai lần đó transaction B update row, A thấy hai giá trị khác nhau.

**Phantom Read** — Transaction A query với WHERE clause, lần đầu thấy N rows. Lần thứ hai query cùng WHERE, thấy N+1 rows vì transaction B vừa insert.

**Lost Update** — Hai transaction update cùng row, một update bị overwrite (cậu biết từ P06/Bài 03).

---

## Bốn Isolation Levels

**READ UNCOMMITTED**
- Cho phép: Dirty Read, Non-repeatable Read, Phantom Read
- Basically không có isolation
- Ai dùng cái này trong production? Không ai. Skip.

**READ COMMITTED**
- Chặn: Dirty Read
- Cho phép: Non-repeatable Read, Phantom Read
- Cách hoạt động: Transaction A đọc row vào lúc T1, transaction B update và commit vào T2, transaction A đọc lại row vào lúc T3, thấy version mới (do MVCC). Đó là "non-repeatable read".
- Khi dùng: Hệ thống không care row bị change giữa lần đọc. Ví dụ read user profile rồi display, được thay đổi giữa lúc request A thấy và request B thấy → okay.
- Vấn đề: Không safe cho transaction mà depend vào "state không thay đổi".

**REPEATABLE READ** (MySQL InnoDB default)
- Chặn: Dirty Read, Non-repeatable Read
- Cho phép: Phantom Read
- Cách hoạt động: Transaction A start, snapshot của database ở thời điểm A start được capture. Mỗi query A làm đều thấy snapshot này, dù B update rows. UPDATE thành UPDATE khác = no-no.
- Khi dùng: Transaction mà cần consistent view suốt execution. HMS use case: appointment booking — mày check slot available, check pricing, áp discount, transfer payment — toàn bộ này phải see consistent state.

**SERIALIZABLE**
- Chặn: Dirty Read, Non-repeatable Read, Phantom Read
- Basically: mỗi transaction chạy như chạy đơn lẻ, một lúc một cái
- Cách hoạt động: Range lock được thêm vào, ngăn insert/update bên ngoài range mà transaction query.
- Khi dùng: Hiếm. Khi vòng tròn transaction đã complexity cao, tốt hơn là dùng pessimistic lock rõ ràng hơn rely SERIALIZABLE.

---

## Anomaly mà mỗi level cho phép — table

```
Level                 | Dirty | Non-rep | Phantom | Lost
READ UNCOMMITTED      |  Y    |    Y    |    Y    |  Y
READ COMMITTED        |  N    |    Y    |    Y    |  N (nếu dùng lock)
REPEATABLE READ       |  N    |    N    |    Y    |  N (nếu dùng lock)
SERIALIZABLE          |  N    |    N    |    N    |  N
```

---

## Ví dụ thực tế — HMS appointment booking

**Scenario:** 2 user cùng lúc book 1 slot.

**Nếu dùng READ COMMITTED:**

```
User A (trx 100):
  SELECT slot FROM schedule WHERE id = X
  → slot = 5

User B (trx 101):
  SELECT slot FROM schedule WHERE id = X
  → slot = 5 (READ COMMITTED thấy version mới nhất đã commit)

User A:
  UPDATE schedule SET slot = 4 WHERE id = X
  → COMMIT

User B:
  UPDATE schedule SET slot = 4 WHERE id = X
  → COMMIT (Lost Update! Đáng lẽ 3)
```

**Fix: Dùng REPEATABLE READ + Optimistic Lock (version)**

```
User A (trx 100):
  SELECT slot, version FROM schedule WHERE id = X
  → slot = 5, version = 10

User B (trx 101):
  SELECT slot, version FROM schedule WHERE id = X
  → slot = 5, version = 10 (REPEATABLE READ, thấy snapshot lúc 101 start)

User A:
  UPDATE schedule SET slot = 4, version = 11 WHERE id = X AND version = 10
  → COMMIT (affected rows = 1, success)

User B:
  UPDATE schedule SET slot = 4, version = 11 WHERE id = X AND version = 10
  → affected rows = 0 (version đã thay đổi, B rollback/retry)
```

REPEATABLE READ ensure B thấy consistent snapshot, nhưng optimistic lock catch "update conflict".

---

## Cách set isolation level trong Spring Boot

MySQL InnoDB default là **REPEATABLE READ**. Spring Boot không tự override database default — `@Transactional` không chỉ định isolation sẽ dùng level của database. Để explicit:

```java
@Transactional(isolation = Isolation.REPEATABLE_READ)
public void bookAppointment(UUID scheduleId) {
    // ...
}
```

Hoặc config global (ví dụ override toàn bộ app sang READ COMMITTED để tăng performance):

```properties
spring.jpa.properties.hibernate.connection.isolation=2
# 1 = READ UNCOMMITTED
# 2 = READ COMMITTED
# 4 = REPEATABLE READ  ← MySQL InnoDB default
# 8 = SERIALIZABLE
```

---

## Cách chọn isolation level cho mỗi transaction

**READ COMMITTED:**
- Hầu hết read-only queries
- Update mà không dependent on "state consistent"
- Ví dụ: Update user last_login_at

**REPEATABLE READ:**
- Transaction mà cần consistent snapshot
- Ví dụ: booking appointment (check slot, transfer money, create appointment — toàn bộ phải see consistent state)
- Transfer tiền từ account A sang B
- Tính toán discount dựa trên promotion hiện tại

**SERIALIZABLE:**
- Hiếm (có thể design lại query thay vì dùng SERIALIZABLE)
- Complex multi-step transaction mà ngoài synchronization control

---

## Phantom Read — nó là gì?

Transaction A query `SELECT * FROM appointment WHERE doctor_id = X AND date = '2025-01-15'`, thấy 5 rows.

Transaction B insert thêm 1 appointment với doctor_id = X, date = '2025-01-15'.

Transaction A query lại cùng condition, thấy 6 rows.

Đó là phantom read. REPEATABLE READ không chặn cái này vì nó chỉ snapshot existing rows, không snapshot "range" của rows.

**Vấn đề khi nào?** Hiếm. Ví dụ cậu query `COUNT(*) FROM appointment WHERE doctor_id = X`, lần sau COUNT lại khác = một loại anomaly. Nhưng thường không ảnh hưởng logic.

**Fix nếu care:** Dùng SERIALIZABLE, hoặc lock range `SELECT ... FOR UPDATE`.

---

## Takeaway

MySQL InnoDB default là REPEATABLE READ — đây là lựa chọn an toàn cho hầu hết transaction. Nhiều app config về READ COMMITTED để giảm lock contention, nhưng cần thêm optimistic lock khi cần consistent snapshot. Combine với version column để catch concurrent writes. SERIALIZABLE hiếm cần — thường có thể đạt cùng kết quả với pessimistic lock explicit.

---

*Bài tiếp theo: Deadlock — vì sao database tự kill query của mày*
