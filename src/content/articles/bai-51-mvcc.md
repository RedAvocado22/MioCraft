---
title: "MVCC — vì sao read không block write"
description: "Multi-Version Concurrency Control là lý do PostgreSQL và MySQL InnoDB có thể xử lý concurrent reads và writes hiệu quả. Hiểu MVCC là hiểu cách database thật sự hoạt động."
category: system-design
pubDate: 2024-02-20
series: "Phần 6: Database"
tags: ["database", "MVCC", "concurrency"]
---

Lúc 9:00 sáng, user A đang reading appointment của mình từ database. Cùng lúc đó, user B sửa appointment của họ. Nếu database theo logic đơn giản — ai hold lock table trước thì ai được, người kia chờ — thì user A phải chờ user B commit xong mới đọc được. Mà nếu user B chậm, user A ngồi đợi, request timeout, user A đi tàm tạm.

Nhưng MySQL không làm vậy. User A vẫn đọc được, user B vẫn sửa được, họ không cần chờ nhau. Cách nó làm là **MVCC** — Multi-Version Concurrency Control.

---

## Ý tưởng cơ bản — lưu nhiều version của cùng một row

Khi bạn update một row, MySQL không overwrite nó. Nó lưu một **version mới** cùng một **version chain**. Mỗi version gắn kèm một con số gọi là **transaction ID**.

Ví dụ, cái appointment này:

```
Row ID: 123
Appointment cho Doctor A, Time: 9:00 AM

Version 1 (trx_id: 100): Doctor A, 9:00 AM, Status: PENDING
Version 2 (trx_id: 105): Doctor A, 9:00 AM, Status: CONFIRMED  <- User B vừa update
```

Khi user A (transaction 103) đọc appointment này, MySQL nó nói — "Transaction 103 thấy transaction 105 chưa commit xong, nên mình cho transaction 103 thấy version 1 (lúc 100 commit). Transaction 105 sau này commit xong, user mới thấy version 2".

User A không phải chờ. User B sửa xong. Cả hai happy.

---

## Implement MVCC trong InnoDB

InnoDB lưu ba cột ẩn cho mỗi row:

**DB_TRX_ID** — Transaction ID của transaction vừa sửa row này lần cuối.

**DB_ROLL_PTR** — Con trỏ tới version cũ hơn (tạo version chain).

**DB_ROW_ID** — Unique row identifier.

Khi transaction A update row:
1. Copy row hiện tại thành version mới
2. Update cột data
3. Set DB_TRX_ID = current transaction ID
4. Set DB_ROLL_PTR = point tới version cũ

Version cũ vẫn nằm ở đó. Không bị xóa ngay. Khi transaction B đọc, nó traverse version chain từ newest backwards, tìm version mà nó có quyền thấy.

---

## Transaction ID và visibility rules

Mỗi transaction khi start được gán một transaction ID duy nhất. MySQL dùng nó để quyết định "transaction này có thấy row version này không".

Rule cơ bản (READ COMMITTED level):
- Nếu version được commit bởi transaction ID < transaction ID của transaction hiện tại → thấy
- Nếu version chưa commit (DB_TRX_ID = active transaction ID) → không thấy (xem version cũ hơn)

Ví dụ:

```
Transaction 100 sửa appointment, gán DB_TRX_ID = 100, commit
Transaction 101 sửa cùng appointment, gán DB_TRX_ID = 101, chưa commit
Transaction 102 đọc appointment

Transaction 102 nhìn: DB_TRX_ID = 101 > 102? Không, version này từ transaction chưa commit
                     Xem version cũ: DB_TRX_ID = 100 < 102? Có, thấy
                     
Vậy transaction 102 thấy version từ transaction 100.
```

---

## Ở đâu version chain này lưu?

Không phải main table. Là **undo log** — một cái file riêng trong InnoDB.

Khi row update, row trong main table được update xong, pointer DB_ROLL_PTR chỉ vào undo log. Nếu transaction khác cần version cũ, nó follow pointer này, reconstruct row từ undo log.

Vì thế undo log không thể bị delete ngay. Nó phải lưu cho tới khi transaction lâu nhất read row này xong, mới được xóa. Nếu bạn có một transaction chạy lâu mà không commit/rollback, undo log sẽ sống lâu, chiếm disk space.

---

## Khi MVCC break — Lost Update

MVCC giải quyết "read không block write". Nhưng nó không giải quyết "write không block write".

Ví dụ, cái race condition mà bạn hỏi hôm nào — 2 user đặt lịch cùng slot:

```
Doctor Schedule: slot = 5/5 (full)

Transaction A: CHECK slot < 5? No → abort
Transaction B: (đồng thời) CHECK slot < 5? No → abort

Chưa có vấn đề.
```

Nhưng nếu logic bạn là:

```
Transaction A: GET current_slot (5/5) → UPDATE slot = 6
Transaction B: (đồng thời) GET current_slot (5/5) → UPDATE slot = 6

Kết quả: slot = 6 (cái này gọi là Lost Update)
```

Cả hai transaction đều thấy cùng value (MVCC), update nó, một update bị "lost" vì bị overwrite.

Giải pháp:
1. **Lock** — SELECT ... FOR UPDATE (P06/Bài 05 sẽ nói)
2. **Optimistic Locking** — Version column (P06/Bài 04 sẽ nói)

---

## Ví dụ thực tế — HMS appointment booking

Bạn có bảng:

```sql
CREATE TABLE doctor_schedule (
    id UUID PRIMARY KEY,
    doctor_id UUID,
    date DATE,
    available_slots INT,
    -- ... columns khác
);
```

User A book appointment:
```java
@Transactional
public void bookAppointment(UUID scheduleId) {
    DoctorSchedule schedule = repo.findById(scheduleId); // SELECT
    if (schedule.getAvailableSlots() > 0) {
        schedule.setAvailableSlots(schedule.getAvailableSlots() - 1); // UPDATE
        repo.save(schedule);
    }
}
```

User B đồng thời book cùng schedule:

```
Time 1: A SELECT available_slots = 5
Time 2: B SELECT available_slots = 5 (MVCC — thấy cùng version vì B start trước A commit)
Time 3: A UPDATE available_slots = 4, COMMIT
Time 4: B UPDATE available_slots = 4, COMMIT (Lost Update! Đáng lẽ phải 3)
```

Để fix, bạn thêm version column:

```sql
ALTER TABLE doctor_schedule ADD COLUMN version INT DEFAULT 0;
```

```java
@Transactional
public void bookAppointment(UUID scheduleId, int currentVersion) {
    DoctorSchedule schedule = repo.findById(scheduleId);
    if (schedule.getAvailableSlots() > 0) {
        schedule.setAvailableSlots(schedule.getAvailableSlots() - 1);
        schedule.setVersion(currentVersion + 1);
        repo.save(schedule); // Spring Data JPA xài version column trong WHERE
    }
}
```

Spring Data JPA tự động generate:

```sql
UPDATE doctor_schedule 
SET available_slots = 4, version = 1 
WHERE id = ? AND version = 0;
```

Khi B cố update với version = 0, nhưng A đã change thành version = 1, MySQL return affected rows = 0. B exception, user phải retry.

---

## Takeaway

MVCC là lý do MySQL hệ thống không bị deadlock trên mỗi read. Nhưng nó không giải quyết concurrent writes. Lúc bạn thấy "2 user update cùng lúc xong data sai", đó không phải bug MVCC, là transaction design của bạn chưa có protection.

---

*Bài tiếp theo: Isolation Levels — bốn cấp độ và khi nào bạn cần cái nào*
