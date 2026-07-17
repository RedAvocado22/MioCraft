---
title: "SQL vs NoSQL — chọn sai là refactor cả đời"
description: "NoSQL không phải phiên bản mới hơn của SQL. Chúng giải quyết vấn đề khác nhau. Chọn dựa trên access pattern, consistency requirement, và team capability — không phải trend."
category: system-design
pubDate: 2024-02-25
series: "Phần 6: Database"
tags: ["database", "SQL", "NoSQL", "trade-off"]
---

Bạn nghe tin NoSQL "scale tốt hơn", "flexible hơn", "không cần schema". Cân nhắc dùng MongoDB cho HMS thay vì MySQL.

Rồi 6 tháng sau, bạn phát hiện:
- Report query phức tạp không viết được dễ
- Data inconsistent vì không có transaction
- Index strategy phức tạp hơn SQL
- Dev team năng suất down vì syntax khác

Muốn refactor lại? Đã quá muộn. Cả terabyte data.

Chọn database type là decision lâu dài. Bạn cần hiểu khi nào nên SQL, khi nào nên NoSQL.

---

## SQL — ACID, Schema, Relational

**Đặc điểm:**
- ACID guarantees — transaction safe
- Schema fixed — column phải match
- Relational — có foreign key, JOIN
- Query language mạnh (SQL) — complex query dễ

**Khi dùng SQL:**
- Data structured, schema clear (appointments có date, time, doctor_id, patient_id)
- Transaction quan trọng (payment phải atomic — hoặc charge card hoặc không, không half-charge)
- Query diverse (report từ nhiều angle)
- Team familiar với SQL (safer, faster to ship)

**Khi tránh SQL:**
- Data unstructured, schema thay đổi thường xuyên (ví dụ IoT sensor data, mỗi loại sensor có field khác nhau)
- Scale horizontal là must-have (SQL single machine by default, sharding phức tạp)
- Write throughput lớn hơn read (SQL optimize read, NoSQL optimize write)

---

## NoSQL — Flexible, Scalable, Eventually Consistent

**Đặc điểm:**
- Flexible schema — document chứa bất kỳ field nào
- Scale horizontal — data split across machines
- Eventually consistent — update lâu hơi mới replicate toàn bộ
- Query language yếu hơn SQL (bị giới hạn)

**Khi dùng NoSQL:**
- Data unstructured (logs, events, JSON từ API)
- Write throughput cực cao (millions/sec)
- Need horizontal scaling ngay (và willing pay latency cost)
- Schema evolution liên tục (startups, thử nhanh)

**Khi tránh NoSQL:**
- Data highly relational (user — appointment — doctor — specialization)
- Transaction critical (payments)
- Ad-hoc query phổ biến (C-level reports, "give me all appointments by doctor by status by month")
- Team không familiar (learning curve, bugs subtle)

---

## Ví dụ thực tế — HMS

**Bảng nào SQL, bảng nào NoSQL?**

**SQL (core business logic):**
- `appointment` — structured, need transaction, query by doctor/patient/date
- `doctor` — fixed schema, need consistency
- `patient` — relational (one patient, multiple appointments)
- `payment` — transaction critical, ACID must-have
- `medical_record` — relational, need join with patient/appointment

**NoSQL (supporting data):**
- `activity_log` — unstructured, write-heavy, query minimal ("show recent activities")
- `notification_queue` — ephemeral, high write, don't care about consistency
- `user_preference` — flexible schema (some users prefer SMS, others email)

**Decision:** MySQL cho core, Redis/MongoDB cho auxiliary. Không recommend pure NoSQL cho HMS.

---

## SQL query mà NoSQL khó làm

```sql
-- Find appointments booking more than 5 patients with status CONFIRMED
-- Group by doctor, count appointments
SELECT 
    d.name,
    COUNT(a.id) as appointment_count,
    SUM(a.fee) as revenue
FROM appointment a
JOIN doctor d ON a.doctor_id = d.id
WHERE a.status = 'CONFIRMED'
    AND a.appointment_time >= DATE_SUB(NOW(), INTERVAL 30 DAY)
GROUP BY d.id, d.name
HAVING COUNT(a.id) >= 5
ORDER BY revenue DESC;
```

Di MongoDB:

```javascript
db.appointments.aggregate([
    { $match: { status: 'CONFIRMED', appointment_time: { $gte: new Date(...) } } },
    { $lookup: { 
        from: 'doctors',
        localField: 'doctor_id',
        foreignField: 'id',
        as: 'doctor'
    }},
    { $unwind: '$doctor' },
    { $group: { 
        _id: '$doctor.id',
        name: { $first: '$doctor.name' },
        appointment_count: { $sum: 1 },
        revenue: { $sum: '$fee' }
    }},
    { $match: { appointment_count: { $gte: 5 } } },
    { $sort: { revenue: -1 } }
]);
```

MongoDB cũng làm được, nhưng cú pháp kỳ quặc hơn, performance kém SQL (không có query optimizer).

---

## SQL vs NoSQL — Performance myth

**Myth:** NoSQL faster.

**Truth:** Depend on pattern.

- **Write 1M documents:** NoSQL faster (designed for high write)
- **Read with complex filter:** SQL faster (query optimizer)
- **Aggregate 100M rows:** SQL faster (GROUP BY optimized)
- **Lookup by ID:** Both same-ish (hash lookup)

HMS bạn — read pattern: "get appointments của doctor này ngày này" — SQL optimize điều này. NoSQL không.

---

## Cách pick: chỉ dùng NoSQL nếu SQL fail

**Start SQL. Sau đó:**

1. **Monitor slow queries** — nếu query chậm (10+ sec), optimize index/query trước
2. **Monitor write throughput** — nếu write lag behind (queue building), xem tại sao (deadlock? constraint check?)
3. **Monitor storage** — nếu storage overflow, denormalize hoặc archive cũ
4. **Chỉ switch NoSQL nếu SQL fundamentally không fit**

Hầu hết project, SQL đủ. Khi nào SQL fail thực sự hiếm (tí xíu %).

---

## Hybrid approach — SQL + NoSQL

Thực tế production:

```
MySQL (core business data):
  - Appointment
  - Doctor
  - Patient
  - Payment

Redis (cache + session):
  - Booking slot availability
  - User session
  - Rate limit counter

MongoDB (audit log + analytics):
  - Activity log
  - Error log
  - Analytics event
```

Không pure SQL, không pure NoSQL. **Polyglot persistence** — dùng database đúng tool cho đúng job.

Ví dụ: Appointment booking.

```java
@Transactional
public void bookAppointment(UUID scheduleId, UUID patientId) {
    // SQL: atomic transaction
    DoctorSchedule schedule = scheduleRepo.findById(scheduleId).lock();
    schedule.decrement();
    
    Appointment app = appointmentRepo.save(new Appointment(...));
    
    // Redis: cache invalidation
    redisCache.invalidate("schedule:" + scheduleId);
    
    // MongoDB: audit log
    mongoAuditLog.insert(new BookingEvent(app.getId(), patientId));
}
```

---

## Takeaway

SQL là default. NoSQL chỉ khi SQL proven not fit (prove bằng metrics: slow query, write bottleneck). HMS của bạn — SQL + Redis là đủ năm tới.

---

*Bài tiếp theo: Soft Delete — đơn giản hơn bạn nghĩ, và phức tạp hơn bạn tưởng*
