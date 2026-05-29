---
title: "NoSQL không scale tốt hơn SQL — đó là cú lừa hoàn hảo"
description: "PostgreSQL scale tốt đến hàng tỷ row với index và sharding đúng cách. Nhiều công ty chuyển sang NoSQL rồi nhận ra vấn đề không phải ở SQL — mà ở cách họ dùng database."
category: system-design
pubDate: 2024-03-17
series: "Phần 9: Không phải lúc nào cũng đúng"
tags: ["tech-myths", "NoSQL", "SQL", "database"]
---

Khoảng 2012–2015, có một làn sóng trong cộng đồng dev: SQL đã chết, NoSQL mới là tương lai. MongoDB, Cassandra, CouchDB — tất cả đều hứa hẹn scale "vô hạn" và linh hoạt hơn cái schema cứng nhắc của SQL.

Một thập kỷ sau, hầu hết các công ty đó đã nhận ra họ đang dùng NoSQL để giải quyết vấn đề mà SQL làm tốt hơn — và đang chịu đựng một đống hậu quả mà SQL không có.

---

## Nguồn gốc của myth này

Câu chuyện bắt đầu từ fact có thật: MongoDB có thể scale horizontally dễ hơn PostgreSQL theo một số chiều nhất định. Cassandra được thiết kế để write-heavy workload ở quy mô Petabyte. DynamoDB của Amazon handle được Amazon Prime Day.

Nhưng từ "một số hệ thống NoSQL scale tốt cho một số use case cụ thể" đến "NoSQL scale tốt hơn SQL" là một bước nhảy vọt sai hoàn toàn.

Scale database không phải về SQL hay NoSQL. Nó là về **data model, access pattern, và hardware.**

---

## SQL scale được — và mày có thể chứng minh điều đó

PostgreSQL handle được hàng chục triệu record và hàng nghìn concurrent connection với config đúng. MySQL tại Facebook, Twitter thời kỳ đầu, Shopify — đều là SQL. Instagram scale đến 1 tỷ user với PostgreSQL trước khi họ bắt đầu sharding.

Vấn đề của SQL không phải là nó không scale. Vấn đề là **vertical scaling có giới hạn** và **horizontal sharding của SQL phức tạp hơn NoSQL** ở một số chiều. Nhưng khi mày chưa đến ngưỡng đó thì đây không phải vấn đề của mày.

Trong HMS, `Appointment` table có thể có vài triệu record sau nhiều năm. PostgreSQL với index đúng chỗ và connection pool tuned sẽ handle cái đó không cần suy nghĩ.

---

## Cái mày đánh mất khi chọn NoSQL

Hãy xem một query thực tế trong HMS: lấy tất cả appointment của một bệnh nhân, kèm thông tin doctor, kèm kết quả khám gần nhất.

Với MySQL:

```sql
SELECT 
    a.id,
    a.appointment_date,
    a.status,
    d.full_name AS doctor_name,
    d.specialization,
    mr.diagnosis AS last_diagnosis
FROM appointments a
JOIN employees d ON a.doctor_id = d.id
JOIN medical_records mr ON mr.appointment_id = (
    SELECT id FROM medical_records 
    WHERE patient_id = a.patient_id 
    ORDER BY created_at DESC 
    LIMIT 1
)
WHERE a.patient_id = ?
ORDER BY a.appointment_date DESC;
```

Một query. Transactional. Consistent. Nếu schema thay đổi, database enforce ngay lập tức.

Với MongoDB, mày sẽ phải:
- Denormalize data (embed doctor info vào appointment document) và chịu data duplication
- Hoặc làm nhiều query rồi join trong application code
- Và bỏ đi ACID transaction — nếu appointment save thành công nhưng update patient record fail thì mày tự xử lý inconsistency

Với HMS — một hệ thống y tế mà data integrity là critical — MongoDB không phải lựa chọn tốt hơn, nó là lựa chọn nguy hiểm hơn.

---

## NoSQL thực sự tốt ở đâu

NoSQL có use case rất rõ ràng:

**Document store (MongoDB):** Khi structure của data genuinely khác nhau giữa các record và mày không muốn 50 nullable column. Ví dụ: product catalog trong e-commerce, mỗi category có attribute khác nhau hoàn toàn.

**Key-value (Redis):** Session, cache, rate limiting counter, distributed lock. HMS đang dùng Redis đúng chỗ — slot booking lock, cache invalidation. Đây là use case Redis sinh ra để làm.

**Wide-column (Cassandra):** Time-series data, event log ở quy mô cực lớn. Mày cần ghi 100,000 event/giây và query theo time range — Cassandra thắng SQL ở đây.

**Search (Elasticsearch):** Full-text search, faceted filter. Nếu HMS cần search bệnh nhân theo tên, địa chỉ, triệu chứng — Elasticsearch làm tốt hơn MySQL `LIKE '%query%'`.

Pattern ở đây là: **chọn tool cho use case cụ thể, không chọn vì trend.**

---

## Takeaway

Câu hỏi không phải "SQL hay NoSQL?" mà là "access pattern của tao là gì và data model nào phù hợp?" Với relational data có transaction requirements, SQL vẫn là lựa chọn tốt nhất sau 50 năm — không phải vì nó cũ, mà vì nó đúng cho bài toán đó.

---

*Bài tiếp theo: Cache không phải lúc nào cũng làm hệ thống nhanh hơn*
