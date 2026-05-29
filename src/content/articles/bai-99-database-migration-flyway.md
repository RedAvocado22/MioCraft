---
title: "Database Migration — vì sao schema thay đổi mà không có migration là đang chơi với lửa"
description: "ALTER TABLE tay trên production, ddl-auto=update, hay migration script có version — ba cách thay đổi schema và tại sao chỉ một cái an toàn. Flyway trong Spring Boot từ đầu đến cuối."
category: system-design
pubDate: 2024-04-17
series: "Phần 6: Database"
tags: ["database", "migration", "flyway", "schema"]
---

---

Trong project sinh viên, workflow thay đổi database trông như thế này: mày mở MySQL Workbench, ALTER TABLE, xong. Hoặc đơn giản hơn — bật `spring.jpa.hibernate.ddl-auto=update` và để Hibernate tự lo.

Cả hai đều hoạt động. Cả hai đều là thảm họa trong production.

---

## Vấn đề với "làm thủ công"

Giả sử team có 3 người. Mày thêm một column `cancellation_reason` vào bảng `appointments`. Mày ALTER TABLE trên local, sửa code, push lên. Teammate pull code về — app crash ngay vì database của họ không có column đó.

Giải pháp hiện tại của team: "nhớ nhắn nhau trên Slack khi đổi schema." Giải pháp này không scale được vì nó phụ thuộc vào con người không quên, không bỏ lỡ tin nhắn, và luôn làm đúng thứ tự.

Rồi đến production deployment. Mày có dám tay ALTER TABLE trên production database khi hệ thống đang chạy không? Nếu có lỗi, mày rollback bằng cách nào?

**Flyway** giải quyết tất cả những câu hỏi này bằng một nguyên tắc đơn giản: *mọi thay đổi schema đều là code, được version control, được track, và được apply tự động theo đúng thứ tự.*

---

## Flyway hoạt động như thế nào

Mày viết migration scripts dưới dạng SQL file, đặt tên theo convention, để vào `src/main/resources/db/migration/`. Khi app khởi động, Flyway:

1. Kiểm tra table `flyway_schema_history` trong database
2. So sánh với danh sách migration files
3. Apply những migration chưa được chạy, theo đúng thứ tự version
4. Ghi lại vào `flyway_schema_history`

Không bao giờ apply lại migration đã chạy. Không bao giờ bỏ qua. Tự động. Deterministic.

Convention đặt tên: `V{version}__{description}.sql`

```
db/migration/
├── V1__create_appointments_table.sql
├── V2__create_doctor_schedules_table.sql
├── V3__add_cancellation_reason_to_appointments.sql
└── V4__add_index_appointments_doctor_date.sql
```

---

## Ví dụ thực tế từ HMS

```sql
-- V3__add_cancellation_reason_to_appointments.sql
ALTER TABLE appointments
    ADD COLUMN cancellation_reason VARCHAR(500) NULL,
    ADD COLUMN cancelled_at TIMESTAMP NULL,
    ADD COLUMN cancelled_by UUID NULL;

-- V4__add_index_appointments_doctor_date.sql
-- Tạo index để tăng tốc query lấy lịch theo doctor + ngày
CREATE INDEX idx_appointments_doctor_date
    ON appointments (doctor_id, appointment_date)
    WHERE status != 'CANCELLED';
```

Mỗi file là immutable sau khi commit. Flyway checksum từng file — nếu mày sửa nội dung một file đã chạy, Flyway sẽ fail khi khởi động và báo lỗi. Đây là feature, không phải bug: nó ngăn mày modify lịch sử.

---

## Setup trong Spring Boot

Dependency:

```xml
<dependency>
    <groupId>org.flywaydb</groupId>
    <artifactId>flyway-core</artifactId>
</dependency>
<dependency>
    <groupId>org.flywaydb</groupId>
    <artifactId>flyway-mysql</artifactId>
</dependency>
```

Config trong `application.yml`:

```yaml
spring:
  flyway:
    enabled: true
    locations: classpath:db/migration
    baseline-on-migrate: true   # Quan trọng nếu DB đã có data từ trước
  jpa:
    hibernate:
      ddl-auto: validate  # ✅ Không để Hibernate tự sửa schema nữa
```

`ddl-auto: validate` là thay đổi quan trọng nhất. Thay vì để Hibernate tự động tạo/sửa schema, giờ nó chỉ validate xem Entity của mày có khớp với schema hiện tại không. Nếu không khớp — app sẽ fail ngay lúc khởi động thay vì fail âm thầm lúc runtime.

---

## Quy tắc bất di bất dịch

**Không bao giờ sửa migration file đã được commit.** Nếu mày cần undo một thay đổi — viết migration mới để revert. Không edit file cũ.

```sql
-- ❌ Sai — đừng sửa V3 nếu đã chạy
-- V3__add_cancellation_reason_to_appointments.sql (đã chạy)

-- ✅ Đúng — tạo migration mới để revert
-- V5__remove_cancelled_by_column.sql
ALTER TABLE appointments DROP COLUMN cancelled_by;
```

Lý do: migration history là audit trail. Nếu mày sửa V3, mày không còn biết production database đang ở trạng thái nào.

**Migration phải idempotent khi có thể.** Dùng `CREATE TABLE IF NOT EXISTS`, `ADD COLUMN IF NOT EXISTS` để migration không fail nếu chạy lại vì lý do bất kỳ.

---

## Takeaway

`ddl-auto=update` là cú lừa hoàn hảo của Hibernate — nó làm mọi thứ "work" lúc dev, rồi trở thành quả bom hẹn giờ lúc production. Chuyển sang Flyway không tốn nhiều hơn 30 phút setup, nhưng nó cho mày thứ quan trọng hơn nhiều: *schema của database luôn đồng bộ với code, ở mọi môi trường, không cần tin tưởng vào con người nhớ làm đúng việc.*

---

*Bài tiếp theo: Pagination — offset vs cursor — và tại sao trang 500 trong hệ thống của mày có thể chậm hơn trang 1 đến 500 lần.*
