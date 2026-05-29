---
title: "Optimistic lock — hai điều dưỡng sửa cùng MedicalRecord"
description: "@Version và OptimisticLockException: last-write-wins im lặng vs báo conflict cho user merge. Khác race booking slot nhưng cùng đau production."
category: system-design
pubDate: 2026-06-01
series: "Phần 10: Case Studies thực tế"
tags: ["case-study", "concurrency", "jpa", "optimistic-lock"]
---


Điều dưỡng A mở hồ sơ bệnh nhân lúc 9:00, sửa ghi chú điều trị. Điều dưỡng B mở cùng hồ sơ lúc 9:02, thêm dị ứng thuốc. B save trước. A save sau — thành công, không lỗi.

Sáng hôm sau bác sĩ đọc hồ sơ: **mất dòng dị ứng** B vừa thêm. Không ai báo lỗi. Không exception trong log. Chỉ có A thắng vì save sau.

Đây là **lost update** — và với dữ liệu y tế, nó nguy hiểm hơn race đặt lịch vì im lặng hơn.

---

## Khác gì với Redis lock đặt slot

Bài đặt lịch cùng slot: hai người tranh **một tài nguyên duy nhất** — slot hoặc được giữ hoặc không. Redis Lua atomic.

Hai người sửa **cùng một row** MedicalRecord: cả hai đều đọc version cũ, sửa field khác nhau, ghi đè lên nhau. DB không tự merge field. Cần **optimistic locking** hoặc **pessimistic lock** (`SELECT FOR UPDATE`).

---

## Optimistic lock với `@Version`

```java
@Entity
public class MedicalRecord {
  @Id
  private UUID id;

  @Version
  private Long version;

  private String treatmentNotes;
  private String allergyNotes;
  // ...
}
```

Mỗi lần update thành công, Hibernate tăng `version` và WHERE clause gồm version cũ:

```sql
UPDATE medical_record
SET treatment_notes = ?, version = 1
WHERE id = ? AND version = 0
```

Nếu B đã update lên `version = 1`, update của A với `version = 0` affect **0 rows** → `OptimisticLockException`.

```java
@Service
public class MedicalRecordService {

  @Transactional
  public MedicalRecordResponse update(UUID id, UpdateMedicalRecordRequest req) {
    var record = medicalRecordRepository.findById(id)
        .orElseThrow(() -> new NotFoundException("RECORD_NOT_FOUND", id));

    record.applyUpdate(req); // set fields từ DTO
    try {
      return mapper.toResponse(medicalRecordRepository.save(record));
    } catch (OptimisticLockException ex) {
      throw new ConflictException("RECORD_CONFLICT",
          "Hồ sơ vừa được người khác cập nhật. Tải lại và thử lại.");
    }
  }
}
```

API trả **409 Conflict** — frontend reload diff, cho user merge hoặc ghi đè có chủ đích.

---

## UX khi conflict

Đừng chỉ hiện "Lỗi hệ thống". Trả thêm snapshot mới nhất (hoặc `version` + `updatedAt` + `updatedBy`):

```java
public record ConflictError(
    String code,
    String message,
    MedicalRecordResponse currentVersion
) {}
```

Client hiển thị: *"Hồ sơ đã thay đổi bởi [tên]. Bạn muốn ghi đè hay hợp nhất?"*

Với PHI, **ghi đè không hỏi** là thiếu trách nhiệm.

---

## Pessimistic lock — khi nào cần

```java
@Lock(LockModeType.PESSIMISTIC_WRITE)
@Query("SELECT m FROM MedicalRecord m WHERE m.id = :id")
Optional<MedicalRecord> findByIdForUpdate(@Param("id") UUID id);
```

Giữ row lock đến hết transaction — phù hợp **thao tác ngắn, bắt buộc serial** (cấp số thuốc, trừ kho). Không giữ lock trong khi user đọc form 20 phút — connection pool chết.

Rule: form dài, user suy nghĩ → **optimistic**. Transaction ngắn, contention cao trên cùng row → cân nhắc pessimistic.

---

## Audit bổ sung

`@Version` chặn lost update lúc save. Không thay thế audit *ai sửa gì lúc nào* — vẫn nên có `updated_by`, `updated_at`, hoặc bảng audit riêng cho compliance.

---

## Takeaway

Nếu entity nhiều người sửa song song — MedicalRecord, Prescription draft — thêm `@Version` sớm, map `OptimisticLockException` → 409. Đừng tin "save sau cùng thắng" là acceptable. Và đừng nhầm với Redis booking: đây là row-level version, không phải slot atomic.

---

*Bài tiếp theo: Outbox pattern — email không mất sau commit.*
