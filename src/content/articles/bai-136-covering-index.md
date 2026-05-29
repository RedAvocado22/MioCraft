---
title: "Covering index — khi query không cần chạm bảng"
description: "EXPLAIN Using index, composite index và thứ tự cột — vì sao index đúng tên vẫn không cover query."
category: system-design
pubDate: 2026-06-06
series: "Phần 6: Database"
tags: ["database", "index", "mysql", "performance"]
---

Dashboard “Lịch hẹn hôm nay theo bác sĩ” chỉ cần `id`, `patient_name`, `scheduled_start_at` — filter `doctor_id` + `date`. Đã có index `(doctor_id, scheduled_start_at)`. EXPLAIN vẫn báo hàng nghìn **rows examined**, latency cao.

Thiếu một khái niệm: **covering index** — index chứa đủ cột query cần, MySQL trả kết quả từ index tree mà không nhảy sang clustered index lấy từng row (bài 49).

---

## Index-only access là gì

InnoDB secondary index leaf node lưu **index columns + primary key** của row. Query chỉ cần các cột **đã nằm trong index** → optimizer có thể dùng **index-only scan** (EXPLAIN `Using index`).

```sql
-- Index chỉ (doctor_id, scheduled_start_at)
SELECT id, patient_id, scheduled_start_at
FROM appointment
WHERE doctor_id = ? AND DATE(scheduled_start_at) = ?;
```

`patient_id` không trong index → cho mỗi match phải **lookup clustered index** (random I/O). Nhiều appointment một ngày → chậm.

**Covering** — thêm cột SELECT vào index (MySQL không có `INCLUDE` như SQL Server; thêm vào composite):

```sql
CREATE INDEX idx_appt_doctor_day_covering
  ON appointment (doctor_id, scheduled_start_at, patient_id, id);
```

Giờ `id`, `patient_id`, `scheduled_start_at` đều trên index leaf → `Using index`, ít đụng bảng chính.

Trade-off: index **rộng hơn** → insert/update nặng hơn, disk lớn hơn. Cover những query **đọc rất nhiều**, không cover mọi cột bảng.

---

## Thứ tự cột trong composite index — leftmost prefix

Index `(A, B, C)` phục vụ:

- `WHERE A`
- `WHERE A AND B`
- `WHERE A AND B AND C`

**Không** phục vụ hiệu quả `WHERE B` alone hoặc `WHERE C` alone (trừ index scan toàn bộ).

Quy tắc thực chiến:

1. Cột **equality** filter trước (`doctor_id = ?`, `clinic_id = ?`)
2. Cột **range** sau (`scheduled_start_at BETWEEN ...`)
3. Cột chỉ xuất hiện trong **SELECT** (covering) cuối

```sql
-- ✅ doctor equality + time range + cover columns
(doctor_id, scheduled_start_at, patient_id, id)

-- ❌ đặt scheduled_start_at trước doctor_id khi query luôn filter doctor_id
(scheduled_start_at, doctor_id, ...)
```

`DATE(scheduled_start_at) = ?` trên column có thể **phá** dùng index — function wrap column. Prefer `scheduled_start_at >= '2026-05-29' AND scheduled_start_at < '2026-05-30'`.

---

## Đọc EXPLAIN — không đủ “có index”

```sql
EXPLAIN SELECT id, patient_id, scheduled_start_at
FROM appointment
WHERE doctor_id = '...'
  AND scheduled_start_at >= '2026-05-29'
  AND scheduled_start_at < '2026-05-30';
```

Quan sát:

- `key`: index nào được chọn
- `Extra: Using index` → covering / index-only
- Không có `Using index` nhưng `key` có → vẫn có thể lookup bảng nhiều lần

Covering không thay thế **selectivity** — index vô ích nếu query trả về nửa bảng (optimizer có thể chọn full scan, bài 49).

---

## Takeaway

Query hot chỉ đọc vài cột: mở EXPLAIN, tìm `Using index`. Nếu không có — xem composite order (equality → range → SELECT columns) và tránh function trên indexed column. Cover có chủ đích, không nhồi hết bảng vào một index.

---

*Bài tiếp theo: Read replica lag — đọc stale sau khi write*
