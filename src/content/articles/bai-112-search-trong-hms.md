---
title: "Search trong HMS — LIKE, FULLTEXT INDEX, và Elasticsearch"
description: "LIKE '%nguyen%' không scale. FULLTEXT cho tên bệnh nhân vừa. Elasticsearch khi cần fuzzy, facet, relevance — đừng over-engineer ngày đầu."
category: system-design
pubDate: 2026-05-30
series: "Phần 10: Case Studies thực tế"
tags: ["case-study", "search", "mysql", "elasticsearch", "database"]
---


Receptionist gõ "Nguyen Van" vào ô tìm bệnh nhân. Mày viết:

```java
@Query("SELECT p FROM Patient p WHERE LOWER(p.fullName) LIKE LOWER(CONCAT('%', :q, '%'))")
List<Patient> search(@Param("q") String query);
```

10.000 bệnh nhân — chạy nhanh. 500.000 bệnh nhân — receptionist bấm tìm, uống cà phê, quay lại spinner vẫn quay. EXPLAIN cho thấy `type: ALL`, `rows: 500000`.

Không phải MySQL chậm. Mày yêu cầu database **quét toàn bộ bảng** vì leading wildcard `%` khiến B-tree index vô dụng.

Search trong HMS không phải một query — là **trade-off giữa độ chính xác, tốc độ, và chi phí vận hành**.

---

## LIKE '%query%' — khi nào đủ, khi nào chết

```sql
-- ❌ Không dùng index — full table scan
SELECT * FROM patient WHERE full_name LIKE '%nguyen%';

-- ✅ Prefix search — có thể dùng index
SELECT * FROM patient WHERE full_name LIKE 'Nguyen%';
```

Leading wildcard = scan. Chỉ chấp nhận được:

- Bảng nhỏ (< vài chục nghìn row) và traffic thấp
- Admin internal tool, không phải search box chính
- Prototype — **không** ship production search chính bằng pattern này

Nếu product yêu cầu *"tìm ở giữa tên"* — LIKE không phải tool đúng ở scale.

---

## FULLTEXT INDEX — sweet spot cho HMS phase đầu

MySQL FULLTEXT (InnoDB từ 5.6+) cho search từ trong text column:

```sql
ALTER TABLE patient
  ADD FULLTEXT INDEX ft_patient_name (full_name);

SELECT id, full_name,
       MATCH(full_name) AGAINST('Nguyen Van' IN NATURAL LANGUAGE MODE) AS score
FROM patient
WHERE MATCH(full_name) AGAINST('Nguyen Van' IN NATURAL LANGUAGE MODE)
ORDER BY score DESC
LIMIT 20;
```

JPA:

```java
@Query(value = """
    SELECT * FROM patient
    WHERE MATCH(full_name) AGAINST(:query IN NATURAL LANGUAGE MODE)
    ORDER BY MATCH(full_name) AGAINST(:query IN NATURAL LANGUAGE MODE) DESC
    LIMIT :limit
    """, nativeQuery = true)
List<Patient> fullTextSearch(@Param("query") String query, @Param("limit") int limit);
```

**Ưu:** Không thêm infrastructure. Đủ cho tên bệnh nhân, ghi chú ngắn, mã hồ sơ kết hợp column riêng.  
**Nhược:** Minimum word length (mặc định 3 ký tự với InnoDB) và stopword list — MySQL English stopword list mặc định có chứa "van", tức `Nguyen Van` có thể chỉ search trên "Nguyen". Config `innodb_ft_enable_stopword=0` để tắt nếu search tên người Việt. Không fuzzy typo (`Nguyne` → `Nguyen`). Không facet phức tạp (lọc theo department + age range + sort relevance đa field).

HMS giai đoạn đầu với vài trăm nghìn patient — **FULLTEXT + index trên `medical_record_number` exact match** thường đủ.

```java
// Exact match — luôn nhanh với unique index
Optional<Patient> findByMedicalRecordNumber(String number);
```

Search box UI: nếu input match pattern `BN-\d+` → query exact trước; còn lại → FULLTEXT.

---

## Elasticsearch — khi nào justify

Đưa ES vào khi có **ít nhất một** nhu cầu thật:

- Tìm **nhiều entity** cùng lúc: patient + appointment + doctor note
- **Fuzzy**, synonym, Vietnamese analyzer tùy chỉnh
- **Faceted search**: bệnh nhân nam, 30–40 tuổi, đã khám khoa X, sort theo relevance
- **Log-scale** data: audit log, clinical notes dài — search sub-second trên triệu document

```text
MySQL (source of truth)
    → Debezium / application event / batch job
    → Elasticsearch index "patients"
    → Search API query ES, hydrate detail từ MySQL bằng ID
```

**Không** sync hai chiều thủ công mỗi request — eventual consistency, handle stale index.

Ví dụ document:

```json
{
  "id": "uuid",
  "fullName": "Nguyen Van A",
  "medicalRecordNumber": "BN-2024-001234",
  "phone": "090...",
  "dateOfBirth": "1990-01-15"
}
```

Search API:

```java
public List<PatientSearchHit> search(String q, int page, int size) {
  var response = elasticsearchClient.search(s -> s
      .index("patients")
      .query(qb -> qb.multiMatch(m -> m
          .fields("fullName^3", "medicalRecordNumber^2", "phone")
          .query(q)
          .fuzziness("AUTO")
      ))
      .from(page * size)
      .size(size),
    PatientDocument.class);
  return mapHits(response);
}
```

Chi phí: cluster ES, mapping migration, monitor lag sync, debug "tìm không ra vì index chưa update".

---

## Decision framework cho HMS

| Nhu cầu | Giải pháp |
|---------|-----------|
| Tìm theo mã hồ sơ chính xác | B-tree index, `=` query |
| Tìm tên, < 500k patients, ít typo tolerance | FULLTEXT |
| Prefix autocomplete "Ngu..." | `LIKE 'Ngu%'` hoặc dedicated autocomplete index |
| Tìm substring giữa tên ở scale lớn | FULLTEXT hoặc ES, không `%...%` |
| Multi-field, fuzzy, facet, analytics search | Elasticsearch |
| Full-text trên PDF/image OCR | ES + pipeline ingest riêng |

Đừng install ES ngày đầu vì "scale sau này" — **operational debt** từ ngày một. Đừng dùng LIKE `%` vì "sau này refactor" — receptionist suffer từ ngày một.

---

## Pagination và limit

Search box luôn `LIMIT 20`. Không trả 5000 row cho frontend filter. Cursor pagination nếu infinite scroll.

---

## Privacy trong search

Search patient leak PHI nếu log query string chứa tên thật. Audit ai search ai. Role receptionist vs doctor scope khác nhau — ABAC filter sau search hoặc filter trong index theo `departmentId`.

---

## Takeaway

`LIKE '%x%'` là hammer cho bài toán cần screwdriver — biết khi nào bảng nhỏ chấp nhận được. FULLTEXT là bước upgrade hợp lý cho HMS tên bệnh nhân. Elasticsearch khi product search **thực sự** cần relevance và scale mà MySQL không đáp ứng — không phải vì resume đẹp. Trước khi chọn, chạy `EXPLAIN` trên production-size data — số liệu quyết định, không phải blog post.

---

*Bài tiếp theo: (tiếp series Case Studies hoặc Phần 6 Database)*
