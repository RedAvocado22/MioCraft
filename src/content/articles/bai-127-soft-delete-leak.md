---
title: "Soft delete leak — data đã xóa vẫn lọt ra API"
description: "@Where giúp nhưng native query, JOIN thiếu filter, và admin export quên deleted_at — patient thấy appointment đã hủy. Cách audit và phòng leak."
category: system-design
pubDate: 2026-05-29
series: "Phần 6: Database"
tags: ["soft-delete", "security", "data-leak", "hibernate"]
---

P06/Bài 09: soft delete = thêm `deleted_at`, mọi query phải lọc. Team thêm `@Where(clause = "deleted_at IS NULL")` lên `Appointment` — tưởng xong.

QA báo: patient mở app vẫn thấy lịch đã hủy tuần trước. Dev grep: repository đúng hết. Bug nằm ở **report SQL native** và **JOIN doctor không filter** — `@Where` không áp vào đó.

Đó là **soft delete leak**: row vẫn trong DB (đúng soft delete), nhưng **lọt ra boundary** user không được phép thấy.

---

## @Where không phải ma thuật toàn cục

Hibernate `@Where` chỉ inject cho entity load qua ORM path. **Không** tự sửa:

```java
@Query(value = """
    SELECT a.* FROM appointment a
    JOIN patient p ON a.patient_id = p.id
    WHERE p.clinic_id = :clinicId
    """, nativeQuery = true)
List<Appointment> findByClinicNative(UUID clinicId);
// ❌ Thiếu AND a.deleted_at IS NULL
```

```java
@Query("""
    SELECT d FROM Doctor d
    JOIN d.appointments a
    WHERE a.patient.id = :patientId
    """)
List<Doctor> findDoctorsWithAppointments(UUID patientId);
// ❌ Filter trên Appointment có thể không áp như bạn tưởng — test thật
```

Rule: **mỗi query mới** — code review hỏi `deleted_at`. Không assume annotation cứu.

---

## JPQL an toàn hơn — pattern repository

```java
public interface AppointmentRepository extends JpaRepository<Appointment, UUID> {

  @Query("SELECT a FROM Appointment a WHERE a.patient.id = :patientId AND a.deletedAt IS NULL")
  List<Appointment> findActiveByPatientId(UUID patientId);

  // Admin xem cả đã xóa — tách method, không reuse nhầm
  @Query("SELECT a FROM Appointment a WHERE a.patient.id = :patientId")
  List<Appointment> findAllIncludingDeletedByPatientId(UUID patientId);
}
```

Tên method `findActive*` vs `findAllIncluding*` — caller khó gọi nhầm hơn overload cùng tên.

---

## Global filter (Hibernate 6)

`@SQLRestriction("deleted_at IS NULL")` trên entity (thay `@Where` deprecated) — vẫn cần native query tự lọc. `@FilterDef` + `@Filter` cho admin session bật tắt — advanced, document rõ khi enable.

---

## Leak qua relation và cache

```java
// Patient load appointment list qua cascade — verify collection filter
@OneToMany(mappedBy = "patient")
private List<Appointment> appointments; // phải là active-only hoặc load qua repo
```

Redis cache key `appointments:patient:{id}` — cancel appointment mà **không invalidate** → user thấy bản cũ (bài 88 territory). Soft delete leak không chỉ SQL.

---

## API và authorization

```java
@GetMapping("/api/appointments/{id}")
public AppointmentResponse get(@PathVariable UUID id) {
  return appointmentService.getActiveForCurrentUser(id);
}

public AppointmentResponse getActiveForCurrentUser(UUID id) {
  var appointment = appointmentRepository.findActiveByIdAndPatientId(id, userContext.getPatientId())
      .orElseThrow(() -> new NotFoundException("APPOINTMENT_NOT_FOUND"));
  // 404 thay vì 403 — không tiết lộ id tồn tại nhưng đã xóa
  return mapper.toResponse(appointment);
}
```

`findById` thuần → deleted row → **200 với data** = leak + GDPR headache.

---

## Audit định kỳ

Script staging/prod read-only:

```sql
-- Appointment soft-deleted nhưng vẫn xuất hiện trong view báo cáo?
SELECT a.id FROM appointment a
WHERE a.deleted_at IS NOT NULL
  AND EXISTS (
    SELECT 1 FROM upcoming_appointments_view v WHERE v.appointment_id = a.id
  );
```

View/materialized report phải sync definition khi thêm soft delete.

---

## Khi nào hard delete hoặc purge

Retention policy: sau 6 tháng **hard delete** row + anonymize audit (bài 57). Giảm surface leak và DB phình.

---

## Takeaway

Sau khi bật soft delete: grep `nativeQuery`, `JOIN`, cache key, export CSV. Một query thiếu `deleted_at IS NULL` = leak. Đặt tên API/repository phân biệt `Active` vs `IncludingDeleted` — đừng trông chờ `@Where` một mình canh cả codebase.

---

*Bài tiếp theo: (tiếp series Production & Ops hoặc case study HMS)*
