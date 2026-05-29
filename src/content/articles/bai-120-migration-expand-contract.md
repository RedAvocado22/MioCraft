---
title: "Migration zero-downtime — expand-contract"
description: "Flyway ADD COLUMN NOT NULL một lần = deploy đứng. Thêm nullable → deploy code → backfill → enforce — schema và app lệch pha có kiểm soát."
category: programming
pubDate: 2026-06-07
series: "Phần 6: Database"
tags: ["database", "flyway", "migration", "deploy"]
---


Ticket: thêm `patient.phone_verified` bắt buộc. Dev viết Flyway:

```sql
ALTER TABLE patient ADD COLUMN phone_verified BOOLEAN NOT NULL DEFAULT false;
```

Deploy một lần — nghe ổn. Tuần sau đổi business: bỏ default, NOT NULL không default cho row mới. Hoặc rename column trong một migration — app cũ vẫn chạy song song pod mới → `Unknown column` 500 toàn hệ thống.

Flyway (bài 99) chạy migration **trước** app mới. Schema và code **không** deploy atomic một giây — luôn có window **schema mới + code cũ** hoặc ngược lại. Expand-contract thiết kế cho window đó.

---

## Ba phase: Expand → Migrate → Contract

**Ví dụ:** đổi `appointment.status` string free-text → enum có constraint.

### Phase 1 — Expand (backward compatible)

Migration V1:

```sql
ALTER TABLE appointment ADD COLUMN status_v2 VARCHAR(32) NULL;
CREATE INDEX idx_appointment_status_v2 ON appointment(status_v2);
```

Code deploy **cả đọc cả ghi** (dual write) hoặc chỉ ghi cả hai:

```java
public void updateStatus(Appointment apt, AppointmentStatus newStatus) {
  apt.setStatusLegacy(newStatus.name()); // cột cũ — tạm
  apt.setStatusV2(newStatus.name());
}
```

Code cũ vẫn đọc cột cũ — không sập.

### Phase 2 — Migrate (backfill)

Job hoặc migration data:

```sql
UPDATE appointment SET status_v2 = status WHERE status_v2 IS NULL;
```

Chạy batch, không lock cả bảng giờ cao điểm — chunk `WHERE id > ? LIMIT 1000`.

### Phase 3 — Contract (breaking, sau khi 100% code mới)

Migration V2 — **chỉ khi** mọi instance chạy code đọc `status_v2`:

```sql
ALTER TABLE appointment DROP COLUMN status;
ALTER TABLE appointment CHANGE status_v2 status VARCHAR(32) NOT NULL;
```

Hoặc giữ tên cột cuối bằng rename có kế hoạch.

---

## ADD NOT NULL column an toàn

```sql
-- ❌ Một bước — OK nếu bảng nhỏ, downtime chấp nhận
ALTER TABLE patient ADD COLUMN phone_verified BOOLEAN NOT NULL DEFAULT false;

-- ✅ Zero-downtime path
-- V1
ALTER TABLE patient ADD COLUMN phone_verified BOOLEAN NULL;
-- deploy app ghi true/false
-- V2 backfill
UPDATE patient SET phone_verified = false WHERE phone_verified IS NULL;
-- V3
ALTER TABLE patient MODIFY phone_verified BOOLEAN NOT NULL;
```

---

## DROP column — code trước, schema sau

1. Deploy code **không còn đọc** column cũ  
2. Flyway drop column  

Drop trước khi code cũ hết = 500.

---

## Rename — đừng rename một shot

Expand: thêm `medical_record_number` mới.  
Dual-write copy.  
Backfill.  
Deploy code đọc cột mới.  
Drop cột cũ.

`ALTER TABLE RENAME` một lần khi còn pod cũ = outage.

---

## Flyway trong pipeline

- Migration chạy **một lần** khi deploy — CI không skip  
- **Không** sửa migration đã merge main — thêm V mới  
- Test rollback strategy: thường **không rollback DDL** — chỉ forward fix  

Staging replay production-size data để estimate lock time `ALTER`.

---

## Takeaway

Mọi thay đổi schema hỏi: *"Pod cũ còn chạy 10 phút thì có sống không?"* Nếu không — expand-contract. Nullable trước, backfill, enforce sau. Drop column sau code. Flyway là công cụ — zero-downtime là **quy trình**.

---

*Bài tiếp theo: On-call — 15 phút đầu đọc log production.*
