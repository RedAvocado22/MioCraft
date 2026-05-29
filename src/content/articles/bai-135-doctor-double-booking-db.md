---
title: "Doctor double-booking — khi race lọt xuống tầng database"
description: "Redis Lua chặn tranh slot ở cache — nhưng confirm vào DB vẫn có thể trùng nếu thiếu ràng buộc và lock đúng chỗ."
category: system-design
pubDate: 2026-06-05
series: "Phần 10: Case Studies thực tế"
tags: ["case-study", "concurrency", "database", "booking", "unique-constraint"]
---

Bài đặt lịch cùng slot (bài 83): Redis Lua atomic — hai request không cùng giữ slot trong cache. Production vẫn có ticket: **hai appointment CONFIRMED** cùng `doctor_id`, cùng `start_at`, khác `patient_id`. Redis log “OK” cả hai.

Race không biến mất khi có Redis — nó **dời xuống** chỗ persist DB, retry, hoặc luồng bypass cache (admin tool, migration, test API).

---

## Vì sao transaction thường không đủ

```java
// ❌ Vẫn double-book dưới concurrent load (khác bài 83 — đây là lúc đã qua Redis hoặc không dùng Redis)
@Transactional
public Appointment confirm(UUID scheduleId, UUID patientId) {
  DoctorSchedule schedule = scheduleRepository.findById(scheduleId).orElseThrow();
  if (schedule.getCurrentPatients() >= schedule.getMaxPatients()) {
    throw new SlotFullException();
  }
  schedule.setCurrentPatients(schedule.getCurrentPatients() + 1);
  scheduleRepository.save(schedule);
  return appointmentRepository.save(buildAppointment(schedule, patientId));
}
```

Hai transaction cùng đọc `currentPatients = 0`, cùng increment, cùng save — **lost update** trên counter. Hoặc hai row `appointment` cùng slot nếu không có unique constraint.

Redis giải quyết **check-and-set ở memory nhanh**. DB cần **ràng buộc cuối cùng** khi data thật nằm ở MySQL.

---

## Lớp phòng thủ 1: UNIQUE constraint

MySQL (InnoDB) — một doctor không hai appointment active cùng thời điểm:

MySQL **không** có partial unique index kiểu PostgreSQL (`WHERE status = ...`). Hai hướng thường gặp:

```sql
-- Hướng 1: unique cứng trên slot (chỉ khi business chấp nhận 1 appointment / slot / doctor)
CREATE UNIQUE INDEX uk_doctor_slot
  ON appointment (doctor_id, scheduled_start_at, clinic_id);
```

```sql
-- Hướng 2: bảng reservation tách — unique trên slot khi status active
CREATE UNIQUE INDEX uk_slot_held
  ON doctor_slot_reservation (doctor_id, scheduled_start_at, clinic_id, status);
-- Chỉ insert row HELD/CONFIRMED; CANCELLED xóa row hoặc đổi status + logic app
```

Soft-delete trên `appointment` + unique `(doctor_id, scheduled_start_at)` dễ conflict nếu row `CANCELLED` vẫn nằm trong bảng — cần thiết kế rõ (xóa hẳn, bảng con, hoặc slot key riêng).

Khi insert trùng:

```java
try {
  appointmentRepository.save(appointment);
} catch (DataIntegrityViolationException e) {
  throw new SlotAlreadyBookedException();
}
```

Đây là **safety net** — không thay UX “slot vừa hết”, nhưng **không bao giờ** để hai row trùng slot im lặng.

---

## Lớp phòng thủ 2: Pessimistic lock đúng row

Khi cần đọc-modify-ghi trên `DoctorSchedule`:

```java
@Transactional
public Appointment confirm(UUID scheduleId, UUID patientId) {
  DoctorSchedule schedule = scheduleRepository
      .findByIdForUpdate(scheduleId)  // SELECT ... FOR UPDATE
      .orElseThrow();
  if (!schedule.hasAvailableSlot()) {
    throw new SlotFullException();
  }
  schedule.incrementPatients();
  scheduleRepository.save(schedule);
  return appointmentRepository.save(...);
}
```

```java
@Lock(LockModeType.PESSIMISTIC_WRITE)
@Query("SELECT s FROM DoctorSchedule s WHERE s.id = :id")
Optional<DoctorSchedule> findByIdForUpdate(@Param("id") UUID id);
```

`FOR UPDATE` giữ lock đến hết transaction — request thứ hai **chờ**, không đọc snapshot cũ (ở isolation phù hợp). Trade-off: contention cao trên hot slot (bài 64).

---

## Redis + DB — ai làm gì

| Tầng | Vai trò |
|------|---------|
| **Redis Lua** | Chặn sớm, UX nhanh, giảm tải DB (bài 83) |
| **DB unique + lock** | Đúng khi Redis miss, TTL hết, admin import, bug invalidate cache |
| **Idempotency** | Tránh double confirm cùng user bấm hai lần (bài 84) |

Không chọn “chỉ Redis” hoặc “chỉ DB” trên production booking — **Redis cho happy path, DB cho truth**.

---

## Takeaway

Sau khi có Redis atomic: thêm unique constraint (hoặc tương đương) trên appointment/slot ở MySQL và test concurrent integration. `SELECT FOR UPDATE` khi logic đếm slot trên row schedule. Double-book im lặng là bug data — DB phải từ chối insert thứ hai, không chỉ log warning.

---

*Bài tiếp theo: Covering index — query chỉ đọc từ index*
