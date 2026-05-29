---
title: "Query Execution Plan — database đang làm gì sau cánh gà"
description: "EXPLAIN ANALYZE là công cụ mạnh nhất để debug query chậm. Hiểu execution plan giúp bạn biết database đang làm gì và tại sao query của bạn không dùng index."
category: system-design
pubDate: 2024-02-19
series: "Phần 6: Database"
tags: ["database", "query-optimization", "performance"]
---

Cậu chạy một query, nó lấy dữ liệu về đúng nhưng khó mà predict nó sẽ nhanh hay chậm từ nhìn SQL. Có lúc query đơn giản mà chậm, có lúc query phức tạp mà nhanh.

Cái bạn cần là cách nhìn vào "kế hoạch" mà MySQL dự định sẽ thực thi query — gọi là **Execution Plan**.

EXPLAIN là công cụ đó. Nó không chạy query, nó chỉ nói — "Tao sẽ làm gì nếu chạy query này". Dựa vào đó, mày có thể biết có cần optimize hay không.

---

## EXPLAIN output — từng cột nghĩa là gì?

Chạy:

```sql
EXPLAIN SELECT * FROM appointment 
WHERE doctor_id = '550e8400-e29b-41d4-a716-446655440000' 
AND created_at >= '2025-01-01';
```

MySQL trả về một table với ~12 cột. Hầu hết chúng lấy 99% signal từ 5 cột chính:

**id:** Thứ tự bảng được query. Nếu có JOIN, mỗi table có một id. Nếu id giống nhau, chúng xảy ra lần lượt (không nested). Thường không care.

**select_type:** Nó là SELECT từ main query hay subquery hay UNION? `SIMPLE` = main query, không cần care chi tiết.

**table:** Cái bảng đang được scan. Self-explanatory.

**type:** **ĐÂY LÀ CÁI QUAN TRỌNG NHẤT.** Nó nói MySQL access table bằng cách nào. Từ nhanh nhất tới chậm nhất:

- `const` — Tìm row bằng primary key với = (nhanh nhất, max 1 row)
- `eq_ref` — JOIN bằng primary key của table khác
- `ref` — Tìm bằng index non-unique (rows > 1)
- `range` — Tìm bằng index với range (>=, <=, BETWEEN)
- `index` — Full scan index (chậm)
- `ALL` — Full scan table (chậm nhất)

Nếu mày nhìn thấy `ALL`, đó là dấu hiệu query có vấn đề.

**key:** Cái index MySQL sẽ xài. `NULL` = không xài index nào, full scan.

**rows:** **ĐÂY LÀ CÁI QUAN TRỌNG LẦN THỨ HAI.** MySQL estimate bao nhiêu rows nó sẽ cần scan để tìm result. Không phải số rows trả về, mà số rows phải examine.

Nếu table có 100,000 rows và query `rows: 50000`, MySQL estimate phải scan nửa table — đó là red flag.

**filtered:** Bao nhiêu % rows MySQL scan sẽ pass WHERE clause. Ví dụ `rows: 1000, filtered: 10%` = scan 1000 rows nhưng chỉ trả về 100 vì filter loại bỏ 90%.

---

## Ví dụ thực tế — đọc EXPLAIN từ HMS query

Query này trong `AppointmentService`:

```java
public List<Appointment> findPendingByPatient(UUID patientId) {
    return repository.findByPatientIdAndStatusOrderByCreatedAtDesc(patientId, "PENDING");
}
```

Chạy EXPLAIN:

```
id | select_type | table       | type | key                       | rows  | filtered
1  | SIMPLE      | appointment | ref  | idx_patient_id_status     | 523   | 100.0
```

Giải thích:
- `type: ref` = xài index để tìm (tốt)
- `key: idx_patient_id_status` = xài composite index trên (patient_id, status)
- `rows: 523` = scan 523 rows (ước tính)
- `filtered: 100%` = toàn bộ 523 rows pass filter (vì cả patient_id và status đều trong WHERE, đã filter xong trong index)

Kết luận: Tốt, không cần optimize.

---

Giờ mày viết query xấu hơn:

```java
public List<Appointment> findByDoctorAndMonth(UUID doctorId, int month) {
    return repository.findAll().stream()
        .filter(a -> a.getDoctor().getId().equals(doctorId) && a.getCreatedAt().getMonthValue() == month)
        .collect(Collectors.toList());
}
```

EXPLAIN cho `findAll()`:

```
id | select_type | table       | type | key  | rows   | filtered
1  | SIMPLE      | appointment | ALL  | NULL | 150000 | 100.0
```

- `type: ALL` = full scan, zero index (rất xấu)
- `rows: 150000` = scan toàn bộ table
- `filtered: 100%` = MySQL không biết filter stream() sẽ làm gì, nên estimate 100% (tức là sau load tất cả 150k rows, Java code mới filter)

Kết luận: Rất xấu. Load 150k rows vào memory để filter trong Java là không chấp nhận được.

---

## Bằng cách nào MySQL tính "rows"?

MySQL không chạy query, nó estimate dựa trên **statistics** nó lưu. Statistics là: "Bảng này có bao nhiêu rows, index này đánh vào bao nhiêu unique values, distribution giữa các giá trị ra sao".

Khi mày tạo index hoặc mỗi khoảng thời gian, MySQL chạy `ANALYZE TABLE` để update statistics.

Nếu statistics lỗi thời, estimate sẽ lệch. Ví dụ mày insert 50k rows hôm nay nhưng chưa chạy ANALYZE lại, MySQL statistics vẫn nghĩ table có 100k rows. Nó sẽ estimate sai.

Fix: `ANALYZE TABLE appointment;` để update statistics.

---

## Cách dùng EXPLAIN để tối ưu từng bước

Mềnh có một complex query từ HMS — tìm appointments của doctor trong ngày hôm nay, group by status:

```sql
SELECT status, COUNT(*) as count
FROM appointment
WHERE doctor_id = '550e8400-e29b-41d4-a716-446655440000'
  AND DATE(created_at) = CURDATE()
GROUP BY status;
```

EXPLAIN result:

```
type: ALL, rows: 150000, Extra: Using where; Using temporary; Using filesort
```

Red flags:
- `type: ALL` = full scan
- `Using temporary` = phải tạo temp table để GROUP BY
- `Using filesort` = phải sort data (chậm)

Optimize step 1 — tạo index trên doctor_id:

```sql
CREATE INDEX idx_doctor_id ON appointment(doctor_id);
```

EXPLAIN:

```
type: ref, rows: 2500, Extra: Using where; Using temporary; Using filesort
```

Tốt hơn (type từ ALL → ref), nhưng vẫn có temp table và filesort.

Optimize step 2 — mây không dùng được function DATE() trên index. Đổi query:

```sql
SELECT status, COUNT(*) as count
FROM appointment
WHERE doctor_id = '550e8400-e29b-41d4-a716-446655440000'
  AND created_at >= DATE_FORMAT(CURDATE(), '%Y-%m-%d 00:00:00')
  AND created_at < DATE_FORMAT(CURDATE() + INTERVAL 1 DAY, '%Y-%m-%d 00:00:00')
GROUP BY status;
```

EXPLAIN:

```
type: range, rows: 120, Extra: Using index condition; Using temporary; Using filesort
```

Rows từ 2500 → 120. Temp table vẫn cần (GROUP BY), nhưng chịu được.

Kết luận: Từng bước nhỏ, check EXPLAIN, optimize. Không phải optimize duyên cầu, là data-driven.

---

## Takeaway

EXPLAIN là cái mirror cho mày nhìn MySQL sẽ làm gì. Lần tới query chậm, chạy EXPLAIN trước, nhìn `type` (là ALL không?), `rows` (con số đáng kính hay không?). Thường vấn đề nằm ở đó.

---

*Bài tiếp theo: MVCC — vì sao read không block write*
