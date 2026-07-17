---
title: "Index là gì — và tại sao tạo index rồi query vẫn chậm?"
description: "Index không phải phép màu. Tạo sai index, query sai cách, hoặc index quá nhiều — đều có thể làm hệ thống chậm hơn thay vì nhanh hơn."
category: system-design
pubDate: 2024-02-18
series: "Phần 6: Database"
tags: ["database", "index", "performance"]
---

Bạn tạo một cái index trên `doctor_id` trong bảng `appointment`, chạy query lại, vẫn chậm. Mở MySQL Workbench, chạy EXPLAIN, nhìn thấy "rows: 50000" — tức là MySQL vẫn scan 50k rows dù có index.

Câu hỏi là: *Mình tạo index rồi mà sao vẫn không xài?*

Câu trả lời là bạn chưa hiểu MySQL lưu data thế nào, lưu index thế nào, và lý do tại sao MySQL quyết định "*đáng lẽ mình không xài index này*".

---

## Trước hết — MySQL lưu data trong file như thế nào?

Khi bạn CREATE TABLE, MySQL không lưu row thành một list tuần tự như bạn tưởng. Nó lưu dưới dạng **cây** — chính xác là **B+ Tree**.

Tính chất của B+ Tree là: nó được sắp xếp theo một key nào đó (gọi là **primary key**). Khi bạn query `SELECT * FROM appointment WHERE id = 123`, MySQL không phải scan 50k rows — nó đi thẳng vào cây, nhảy tới node chứa id = 123 trong vài phép nhảy (log n).

Cây này gọi là **clustered index** — nó chứa data thực sự. Khi bạn tạo primary key, bạn đã tạo cái này.

Khi bạn tạo thêm index khác (ví dụ `CREATE INDEX idx_doctor ON appointment(doctor_id)`), MySQL tạo một cây *khác* — **secondary index**. Cây này cũng là B+ Tree, nhưng nó chỉ lưu `doctor_id` + con trỏ tới clustered index, không lưu toàn bộ row.

Ý tưởng là: "Nếu bạn tìm appointment bằng doctor_id, mình nhảy vào cây secondary index (nhanh), tìm được id, rồi nhảy vào clustered index để lấy data thực sự".

Đó là nó *supposed to work*. Nhưng thực tế, MySQL có một cái quyết định khá xảo: nếu lợi nên dùng index không rõ ràng, nó sẽ chọn full scan vì full scan có thể faster.

---

## Tại sao MySQL từ chối xài index của bạn?

Có ba lý do chính:

**Lý do 1 — Selectivity quá thấp**

Bạn vừa tạo index trên `doctor_id`. Nhưng dataset HMS của bạn hiện tại có 50,000 appointments và chỉ 100 doctors. Khi bạn query `WHERE doctor_id = 5`, index nó sẽ trả về ~500 rows (50k / 100).

MySQL tính toán: "Mình dùng index để jump vào cây, tìm được 500 row keys, rồi jump 500 lần vào clustered index để lấy data. Hay mình full scan 50k rows một lần, lọc trong memory được 500. Cái nào nhanh hơn?"

Thực ra — full scan nhanh hơn vì locality of reference (dữ liệu nằm gần nhau trên disk, scan tuần tự nhanh hơn random jumps).

**Lý do 2 — Bạn query sai cách**

```java
// ❌ MySQL sẽ ignore index
SELECT * FROM appointment 
WHERE YEAR(created_at) = 2025;
```

Bạn function trên column → MySQL không thể xài index trên `created_at` vì nó phải evaluate function cho mỗi row (tức là full scan anyway).

```java
// ✅ MySQL sẽ xài index
SELECT * FROM appointment 
WHERE created_at >= '2025-01-01' AND created_at < '2025-02-01';
```

**Lý do 3 — Index coverage không đủ**

Bạn query:

```sql
SELECT doctor_id, patient_id, status 
FROM appointment 
WHERE doctor_id = 5 AND status = 'CONFIRMED';
```

Bạn có index trên `doctor_id`, nhưng không có trên `(doctor_id, status)`. MySQL sẽ dùng index `doctor_id`, jump vào cây, tìm được 500 appointments, rồi filter `status = 'CONFIRMED'` — nhưng phần filter này vẫn cần full scan kết quả của index.

Nếu chỉ 10 appointment thực sự CONFIRMED, MySQL tính: "Mình có thể full scan column `status` 50k rows hoàn toàn, hay dùng index để jump rồi filter 500 rows. Cái nào throughput cao hơn?"

Depend vào data distribution, MySQL có thể bỏ index.

---

## Ví dụ thực tế — Index ở HMS

Bảng `doctor_schedule` của bạn có columns:
- `id` (primary key)
- `doctor_id` (foreign key)
- `date` (LocalDate)
- `slot` (int, 1-10)
- `is_active` (boolean)

Query phổ biến nhất:

```java
// Service method
public List<DoctorSchedule> findAvailableSlots(UUID doctorId, LocalDate date) {
    return repository.findByDoctorIdAndDateAndIsActiveTrue(doctorId, date);
}
```

Spring Data JPA tự động generate SQL:

```sql
SELECT * FROM doctor_schedule 
WHERE doctor_id = ? AND date = ? AND is_active = 1;
```

Nếu bạn chỉ có index trên `doctor_id`, MySQL sẽ:
1. Jump vào index, tìm tất cả rows với doctor_id = X
2. Filter `date = ? AND is_active = 1` từ kết quả

Nhưng nếu bạn có composite index:

```sql
CREATE INDEX idx_doctor_date_active ON doctor_schedule(doctor_id, date, is_active);
```

MySQL sẽ dùng index, jump vào cây, jump tiếp qua branch `date`, jump tiếp qua branch `is_active` — toàn bộ filter hoàn toàn trong index, không cần clustered index.

Đó gọi là **index covering** — index chứa toàn bộ columns mà bạn cần để trả về kết quả.

---

## Làm sao để biết index của bạn có được xài không?

Dùng EXPLAIN:

```sql
EXPLAIN SELECT * FROM doctor_schedule 
WHERE doctor_id = '550e8400-e29b-41d4-a716-446655440000' 
AND date = '2025-01-15' 
AND is_active = 1;
```

Nhìn cột `key` — nếu nó show tên index của bạn, nó được xài. Nếu nó show `NULL`, full scan.

Nhìn `rows` — MySQL estimate cần scan bao nhiêu rows. Nếu nó con số lớn hơn 1% total rows, có thể là full scan cheaper hơn.

Nhìn `type` — nếu nó `range` hoặc `ref`, nó đang xài index. Nếu nó `ALL`, full scan.

---

## Takeaway

Index không phải viết xong rồi là nó xài. Nó xài hoặc không xài dựa trên cost estimation của MySQL — selectivity, query pattern, index structure. Lần tới tạo index mà vẫn chậm, chạy EXPLAIN trước tiên, không phải assume.

---

*Bài tiếp theo: Query Execution Plan — database đang làm gì sau cánh gà*
