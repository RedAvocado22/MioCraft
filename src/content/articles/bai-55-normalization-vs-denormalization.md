---
title: "Normalization vs Denormalization — chuẩn hóa bao nhiêu là đủ?"
description: "Normalize quá thì JOIN nhiều, query chậm. Denormalize quá thì data inconsistency. Không có công thức cố định — chỉ có trade-off dựa trên access pattern thực tế."
category: system-design
pubDate: 2024-02-24
series: "Phần 6: Database"
tags: ["database", "normalization", "schema-design"]
---

Lúc bạn lên lớp, thầy dạy database design bắt normalize hết sạch — tách bảng cho đến 3NF (normal form thứ 3), không duplicate data, mỗi dữ liệu chỉ lưu một chỗ.

Thật vậy, doctor ghi lại contact info, address — tách riêng bảng. Bệnh nhân cũng vậy. Payment method tách bảng riêng. Hết.

Kết quả: 15 tables, 30 joins, query chạy 3 giây. User thấy "loading..." xong lại "timeout".

Cái vấn đề là: **normalization cho consistency, denormalization cho performance. Bạn cần balance, không phải pick một.**

---

## Normalization là gì? Tại sao nó tồn tại?

Normalization là quy tắc thiết kế database sao cho:
- Không duplicate data (một fact chỉ lưu một chỗ)
- Change một thứ chỉ update một chỗ
- Không insert anomaly (ví dụ không thể insert doctor mà không có address vì foreign key constraint)

Ví dụ, bảng "bad":

```sql
CREATE TABLE appointment_flat (
    id UUID PRIMARY KEY,
    appointment_time DATETIME,
    
    doctor_id UUID,
    doctor_name VARCHAR(255),
    doctor_specialization VARCHAR(255),
    doctor_phone VARCHAR(20),
    
    patient_id UUID,
    patient_name VARCHAR(255),
    patient_email VARCHAR(255)
);
```

Vấn đề: doctor_name được duplicate mỗi lần doctor có appointment. Update doctor name? Update 100 rows. Quên update một? Data inconsistent.

**Normalized version:**

```sql
CREATE TABLE doctor (
    id UUID PRIMARY KEY,
    name VARCHAR(255),
    specialization VARCHAR(255),
    phone VARCHAR(20)
);

CREATE TABLE patient (
    id UUID PRIMARY KEY,
    name VARCHAR(255),
    email VARCHAR(255)
);

CREATE TABLE appointment (
    id UUID PRIMARY KEY,
    appointment_time DATETIME,
    doctor_id UUID REFERENCES doctor(id),
    patient_id UUID REFERENCES patient(id)
);
```

Doctor name một chỗ. Update tên = một UPDATE statement.

---

## Denormalization — tại sao bạn cần nó?

Normalized database đạt consistent, nhưng query phải JOIN bảng này sang bảng khác. Với 100 appointments:

```sql
SELECT a.id, a.appointment_time, d.name, p.name
FROM appointment a
JOIN doctor d ON a.doctor_id = d.id
JOIN patient p ON a.patient_id = p.id;
```

Ngay cái query này, database phải:
1. Read appointment table
2. Cho mỗi row, lookup trong doctor table
3. Cho mỗi row, lookup trong patient table
4. Join lại

Nếu bảng lớn, JOIN trở thành bottleneck.

Denormalization = "ghi thêm doctor_name vào appointment table", accept duplicate, để query faster.

```sql
ALTER TABLE appointment ADD COLUMN doctor_name VARCHAR(255);
```

Bây giờ:

```sql
SELECT id, appointment_time, doctor_name, patient_name
FROM appointment;
```

No JOIN. Query fast. Trade-off: khi update doctor name, phải update appointment table cùng.

---

## Khi nào normalize, khi nào denormalize?

**Normalize khi:**
- Data thay đổi thường xuyên (update doctor info? phải update tất cả appointments nếu denormalized)
- Query là secondary (writes quan trọng hơn reads)
- Storage giới hạn (duplicate data = waste space)
- Consistency là top priority (bank system, healthcare)

**Denormalize khi:**
- Data ít thay đổi (doctor info? mỗi năm update lần)
- Query là primary bottleneck (read-heavy workload)
- Storage không shortage (storage rẻ, latency đắt)
- Read performance critical (e-commerce product listing, analytics)

---

## Ví dụ HMS — normalize hay denormalize doctor info?

**Question:** Doctor appointment table có nên lưu `doctor_name` không?

**Analysis:**
- Bao lâu update doctor name? Hiếm (có thể quên update appointment table)
- Bao lâu query doctor name? Mỗi lần user view appointment (thường xuyên)
- Consistency cost nếu denormalize? Medium (phải update 2 tables)

**Decision:** Normalize. Doctor name lưu ở doctor table, appointment JOIN doctor table. Vì:
- Update name = 1 statement
- Consistency guarantee (FK constraint)
- HMS là healthcare — consistency > performance
- Query JOIN không nặng nếu có index

---

Nhưng **booking history** (status, time booked, notes)? Ít thay đổi, sẽ query 100 lần/ngày.

**Decision:** Denormalize. Copy `doctor_name_at_booking_time`, `patient_status_at_booking_time` vào appointment table. Vì:
- Query không phải JOIN
- Data frozen (không thay đổi sau booking)
- Performance improvement rõ rệt

---

## Cách implement denormalization an toàn

Không phải random ghi thêm column. Có quy tắc:

**Rule 1 — Data denormalize phải frozen**

```java
// ❌ Xấu
@Entity
public class Appointment {
    @ManyToOne
    private Doctor doctor; // Lưu reference
    
    private String doctorName; // Lưu duplicate
}
```

Lúc update doctor.name, appointment.doctorName không auto update. Inconsistent.

```java
// ✅ Tốt
@Entity
public class Appointment {
    private UUID doctorId;
    private String doctorNameAtBooking; // "at booking time" — frozen
    
    // Khi booking, store tên lúc đó
    public Appointment(Doctor doctor) {
        this.doctorId = doctor.getId();
        this.doctorNameAtBooking = doctor.getName(); // Snapshot
    }
}
```

doctorNameAtBooking không bao giờ update. Nó là snapshot lúc booking.

**Rule 2 — Denormalize chỉ cho read-heavy path**

```java
// ❌ Sai
@Entity
public class Doctor {
    private String name;
    private int totalAppointmentsCount; // Denormalize counter
}
```

Mỗi lần tạo appointment, phải `UPDATE doctor SET totalAppointmentsCount = totalAppointmentsCount + 1`. Risk race condition, deadlock.

```java
// ✅ Đúng
// Không denormalize counter vào doctor table
// Thay vào đó, query-time COUNT:
SELECT COUNT(*) FROM appointment WHERE doctor_id = ?;
// Hoặc cache result (P07/Bài 04 sẽ nói)
```

**Rule 3 — Denormalize ở boundary (tidak deeply nested)**

```java
// ❌ Sai — denormalize quá sâu
@Entity
public class Appointment {
    private String doctorName;
    private String doctorSpecialization;
    private String doctorPhoneNumber;
    private String doctorOfficeAddress;
    private String doctorOfficeCity;
    // ... 10 columns
}
```

Lúc doctor update contact info, cần update appointment table. Risk data skew.

```java
// ✅ Đúng — denormalize chỉ cần thiết nhất
@Entity
public class Appointment {
    private UUID doctorId; // Link để lookup nếu cần full info
    private String doctorNameAtBooking; // Snapshot cho display
    
    @ManyToOne
    private Doctor doctor; // Nếu cần chi tiết, JOIN thêm
}
```

---

## Ví dụ thực tế — HMS payment history

**Scenario:** User xem lịch thanh toán. Muốn thấy:
- Appointment time
- Doctor name
- Amount paid
- Payment method used

**Bảng:**

```sql
CREATE TABLE payment (
    id UUID PRIMARY KEY,
    appointment_id UUID REFERENCES appointment(id),
    amount DECIMAL(10, 2),
    payment_method VARCHAR(50), -- CREDIT_CARD, BANK_TRANSFER
    created_at DATETIME
);
```

**Normalized query:**

```sql
SELECT p.id, a.appointment_time, d.name, p.amount, p.payment_method
FROM payment p
JOIN appointment a ON p.appointment_id = a.id
JOIN doctor d ON a.doctor_id = d.id
ORDER BY p.created_at DESC;
```

3 joins, có thể chậm nếu million payments.

**Denormalize:**

```sql
ALTER TABLE payment ADD COLUMN doctor_name_at_payment VARCHAR(255);
ALTER TABLE payment ADD COLUMN appointment_time_at_payment DATETIME;
```

**Insert:**

```java
@Transactional
public Payment createPayment(UUID appointmentId, BigDecimal amount, String method) {
    Appointment app = appointmentRepo.findById(appointmentId);
    
    Payment payment = new Payment();
    payment.setAppointmentId(appointmentId);
    payment.setAmount(amount);
    payment.setPaymentMethod(method);
    payment.setDoctorNameAtPayment(app.getDoctor().getName()); // Snapshot
    payment.setAppointmentTimeAtPayment(app.getAppointmentTime()); // Snapshot
    
    return paymentRepo.save(payment);
}
```

**Query:**

```sql
SELECT id, appointment_time_at_payment, doctor_name_at_payment, amount, payment_method
FROM payment
ORDER BY created_at DESC;
```

1 query, no JOIN, fast.

---

## Takeaway

Mở đầu normalized (tránh duplicate). Khi query trở bottleneck, identify cái nào denormalize (thường là read-heavy path, data frozen). Không denormalize tùy tiện — phải có lý do.

---

*Bài tiếp theo: SQL vs NoSQL — chọn sai là refactor cả đời*
