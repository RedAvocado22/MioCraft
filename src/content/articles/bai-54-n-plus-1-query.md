---
title: "N+1 Query — bug thầm lặng giết performance từ từ"
description: "Load 100 user, mỗi user trigger thêm 1 query để lấy orders — là 101 queries thay vì 2. N+1 không gây lỗi, chỉ làm app ngày càng chậm cho đến khi không thể chịu được."
category: system-design
pubDate: 2024-02-23
series: "Phần 6: Database"
tags: ["database", "N+1", "ORM", "performance"]
---

Mày load 100 appointments, mỗi cái appointment có một doctor. Logic đơn giản:

```java
List<Appointment> appointments = appointmentRepo.findAll(); // 1 query
for (Appointment a : appointments) {
    Doctor doctor = a.getDoctor(); // 100 queries (N+1)
}
```

Tổng 101 queries. Nếu load 1000 appointments, 1001 queries. Khi hệ thống to, cái này sẽ kill performance từ từ. Hôm nay chưa thấy gì, 6 tháng sau hệ thống chậm từng ngày, không biết tại sao.

Cậu nói cần ngồi kỹ log để nhận ra. Tôi sẽ teach cậu cách spotted mặt nó ngay lập tức.

---

## Khi nào N+1 xảy ra?

Hibernate (ORM mà Spring Boot dùng) đã cấu hình lazy loading — khi load appointment, doctor không được load luôn. Chỉ khi access `appointment.getDoctor()`, query sẽ chạy.

Lý do: optimize case "mày chỉ cần appointment, không cần doctor". Nhưng nếu cậu loop appointments rồi access doctor, cái này thành vấn đề.

---

## Cách spotted N+1 trong log

**Dấu hiệu 1 — Query pattern lặp lại**

```
Hibernate: select * from appointment where id = ?
Hibernate: select * from doctor where id = ?      ← bind param = doctor id của appointment 1
Hibernate: select * from doctor where id = ?      ← bind param = doctor id của appointment 2
Hibernate: select * from doctor where id = ?      ← bind param = doctor id của appointment 3
...
```

Nếu mày thấy cùng query SELECT chạy rất nhiều lần với bind params khác nhau → **N+1 spotted**. Cái này không xảy ra nếu eager load (JOIN).

**Dấu hiệu 2 — Execution time spike**

```
09:23:01 Executing 1 query in 2ms        ← SELECT appointments (fast)
09:23:01 Executing 100 queries in 500ms  ← SELECT doctor loop (slow)
09:23:01 Total time: 502ms
```

Một query chạy nhanh, rồi bất ngờ 100 query chạy tương tự → **N+1 spotted**.

**Dấu hiệu 3 — Log có pattern "FOR EACH ROW"**

Nếu mày dùng logging framework show SQL, thường nó sẽ show:

```
[AppointmentService.getAppointments] Executing query:
  select a.* from appointment a

[Appointment.getDoctor] Lazy initializing proxy [Doctor#123]
[Appointment.getDoctor] Executing query:
  select d.* from doctor d where d.id = 123

[Appointment.getDoctor] Lazy initializing proxy [Doctor#456]
[Appointment.getDoctor] Executing query:
  select d.* from doctor d where d.id = 456
```

"Lazy initializing" lặp lại 100 lần → **N+1 spotted**.

---

## Cách fix N+1

**Fix 1 — Eager load (JOIN)**

```java
// ❌ N+1
public List<Appointment> findAll() {
    return appointmentRepo.findAll();
}
```

```java
// ✅ Eager load
public List<Appointment> findAll() {
    return appointmentRepo.findAll(); // Change repository
}

// Repository
public interface AppointmentRepository extends JpaRepository<Appointment, UUID> {
    @Query("SELECT a FROM Appointment a JOIN FETCH a.doctor")
    List<Appointment> findAll();
}
```

`JOIN FETCH a.doctor` = trong cùng query, lấy luôn doctor. Kết quả: 1 query dùng JOIN, không 101 query.

**Fix 2 — Lazy loading nhưng batch fetch**

Nếu cậu không muốn JOIN (vì query sẽ duplicate appointment rows nếu doctor có nhiều appointments), dùng batch fetching:

```properties
spring.jpa.properties.hibernate.default_batch_fetch_size=10
```

```java
@ManyToOne(fetch = FetchType.LAZY)
@BatchSize(size = 10)
private Doctor doctor;
```

Giờ khi access doctor, Hibernate sẽ:
- Query 1: SELECT * FROM appointment (100 rows)
- Query 2: SELECT * FROM doctor WHERE id IN (?, ?, ..., ?) (10 ids mỗi batch)
- Query 3: SELECT * FROM doctor WHERE id IN (?, ?, ..., ?) (10 ids)
- ...

Thay vì 101 queries, bây giờ 11 queries. Không perfect như JOIN, nhưng acceptable.

**Fix 3 — DTO projection**

Nếu cậu không cần object model phức tạp, dùng DTO:

```java
public interface AppointmentDto {
    UUID getId();
    LocalDateTime getCreatedAt();
    String getDoctorName();
}

// Repository
public interface AppointmentRepository extends JpaRepository<Appointment, UUID> {
    @Query("SELECT new map(" +
            "a.id as id, " +
            "a.createdAt as createdAt, " +
            "d.name as doctorName) " +
           "FROM Appointment a " +
           "JOIN a.doctor d")
    List<Map<String, Object>> findAllWithDoctor();
}
```

1 query dùng JOIN, trả về flat data. Không cần load object graph.

---

## Ví dụ thực tế — HMS appointment list

**Code xấu:**

```java
@GetMapping("/appointments")
public List<AppointmentResponse> list() {
    List<Appointment> apps = appointmentRepo.findAll(); // Query 1
    return apps.stream().map(a -> {
        AppointmentResponse resp = new AppointmentResponse();
        resp.setId(a.getId());
        resp.setDoctorName(a.getDoctor().getName()); // Query 2, 3, 4, ... N+1
        resp.setPatientName(a.getPatient().getName()); // Query N+2, N+3, ...
        return resp;
    }).collect(Collectors.toList());
}
```

Nếu 100 appointments, 1 + 100 (doctor) + 100 (patient) = 201 queries.

**Fix bằng custom query:**

```java
@Repository
public interface AppointmentRepository extends JpaRepository<Appointment, UUID> {
    @Query("SELECT a FROM Appointment a " +
           "JOIN FETCH a.doctor d " +
           "JOIN FETCH a.patient p")
    List<Appointment> findAllWithDocsAndPatients();
}

@GetMapping("/appointments")
public List<AppointmentResponse> list() {
    List<Appointment> apps = appointmentRepo.findAllWithDocsAndPatients(); // 1 query
    return apps.stream().map(mapper::toResponse).collect(Collectors.toList());
}
```

**Hoặc fix bằng batch:**

```java
@ManyToOne(fetch = FetchType.LAZY)
@BatchSize(size = 20)
private Doctor doctor;

@ManyToOne(fetch = FetchType.LAZY)
@BatchSize(size = 20)
private Patient patient;
```

201 queries → 6 queries (1 appointments + 5 batches doctors + 5 batches patients = roughly).

---

## Cách prevent N+1 từ đầu

**Rule 1 — Specify fetch strategy khi design entity**

```java
@Entity
public class Appointment {
    @ManyToOne(fetch = FetchType.EAGER) // ⚠️ Eager load default
    private Doctor doctor;
    
    @ManyToOne(fetch = FetchType.LAZY) // Default
    private Patient patient;
}
```

EAGER load = luôn join, nhưng risky nếu entity phức tạp (tất cả relations được load).

LAZY load = on-demand, nên set @BatchSize nếu collection.

**Rule 2 — Query riêng cho từng use case**

Không dùng findAll() cho hết. Viết query custom:

```java
@Query("SELECT a FROM Appointment a " +
       "LEFT JOIN FETCH a.doctor " +
       "WHERE a.date = :date")
List<Appointment> findByDateWithDoctor(LocalDate date);

@Query("SELECT a FROM Appointment a " +
       "WHERE a.id = :id")
Appointment findSimple(UUID id); // Không load doctor nếu không cần
```

**Rule 3 — Log queries trong dev**

```properties
spring.jpa.show-sql=true
spring.jpa.properties.hibernate.format_sql=true
logging.level.org.hibernate.SQL=DEBUG
```

Khi ngồi code, log sẽ show mỗi query. Nếu thấy query lặp lại → fix ngay, không chờ production.

---

## Takeaway

N+1 không biến mất, nó ẩn. Log nó là dấu hiệu performance sẽ suy. Lúc viết query ở repository, hỏi: "Mình sẽ call entity này bao nhiêu lần? Nếu > 1, cần fetch gì cùng?".

---

*Bài tiếp theo: Normalization vs Denormalization — chuẩn hóa bao nhiêu là đủ?*
