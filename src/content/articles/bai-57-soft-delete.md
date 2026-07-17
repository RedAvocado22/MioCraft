---
title: "Soft Delete — đơn giản hơn bạn nghĩ, và phức tạp hơn bạn tưởng"
description: "Thêm cột is_deleted tưởng là dễ — cho đến khi unique constraint bị vỡ, query trở nên phức tạp, và audit log không hoạt động như kỳ vọng."
category: system-design
pubDate: 2024-02-26
series: "Phần 6: Database"
tags: ["database", "soft-delete", "schema-design"]
---

User bấm "delete appointment". Bạn có hai cách:

**Hard delete:** Xóa row khỏi database.

**Soft delete:** Giữ row, set `deleted_at = NOW()`.

Nghe qua, soft delete an toàn hơn (có thể undo, audit trail, GDPR compliant hơn). Nhưng nó introduce một complexity:

Mỗi query từ giờ phải check `WHERE deleted_at IS NULL`. Quên một query? Data leak.

---

## Tại sao soft delete?

**Lý do 1 — Audit trail**

```sql
SELECT * FROM appointment WHERE id = X AND deleted_at IS NOT NULL;
```

Bạn có thể xem "ai delete, lúc nào". Healthcare regulation (HIPAA) yêu cầu audit trail.

**Lý do 2 — Undo**

```sql
UPDATE appointment SET deleted_at = NULL WHERE id = X;
```

User thay đổi ý, bạn undo được.

**Lý do 3 — Foreign key safety**

Hard delete: xóa doctor → tất cả appointment của doctor bị orphan (ON DELETE CASCADE) hoặc error (ON DELETE RESTRICT).

Soft delete: doctor vẫn ở, chỉ là inactive. Appointment vẫn có reference valid.

---

## Vấn đề của soft delete

**Vấn đề 1 — Mỗi query phải check deleted_at**

```java
// ❌ Quên check deleted_at
public Appointment getAppointment(UUID id) {
    return appointmentRepo.findById(id); // Có thể return deleted appointment!
}
```

```java
// ✅ Phải explicit
public Appointment getAppointment(UUID id) {
    return appointmentRepo.findByIdAndDeletedAtIsNull(id);
}
```

Nếu bạn có 100 query methods trong codebase, bạn phải check mỗi cái. Một query quên = bug.

**Vấn đề 2 — Unique constraint bị sai**

```sql
CREATE TABLE doctor (
    id UUID PRIMARY KEY,
    email VARCHAR(255) UNIQUE,
    deleted_at DATETIME
);
```

Doctor A có email "alice@hospital.com". Xóa doctor A (soft delete, deleted_at = now).

Doctor B cố register cùng email → ERROR: "Email already exists" (unique constraint không ignore deleted).

```java
// ❌ Xấu
INSERT INTO doctor (email) VALUES ('alice@hospital.com'); 
-- Error: duplicate email, even though A is deleted
```

**Fix:**

```sql
-- Unique chỉ apply cho non-deleted
CREATE UNIQUE INDEX idx_email_not_deleted 
ON doctor(email) 
WHERE deleted_at IS NULL;
```

Bây giờ constraint chỉ enforce deleted_at = NULL rows. Deleted rows ignore.

**Vấn đề 3 — N+1 problem + deleted rows**

Bạn query appointment, mỗi query phải check deleted_at:

```sql
SELECT * FROM appointment WHERE deleted_at IS NULL;
```

Nếu quên index:

```sql
CREATE INDEX idx_deleted_at ON appointment(deleted_at);
```

Hay tốt hơn:

```sql
CREATE INDEX idx_active ON appointment(deleted_at) WHERE deleted_at IS NULL;
```

(Partial index — chỉ index NULL rows, hemat space)

**Vấn đề 4 — Soft delete lại delete (logical vs physical)**

User delete appointment, stored soft = deleted_at = T1.

Sau đó admin thay đổi ý, undelete = deleted_at = NULL.

Rồi user delete lại = deleted_at = T2.

Query sau này không biết appointment bị delete bao nhiêu lần.

```java
// Nếu bạn care về history, cần audit table riêng
@Entity
public class AppointmentAudit {
    UUID appointment_id;
    String action; // DELETE, UNDELETE
    LocalDateTime action_at;
    String reason;
}
```

---

## Cách implement soft delete đúng cách

**Option 1 — Base class với deleted_at**

```java
@MappedSuperclass
public class BaseEntity {
    @Id
    private UUID id;
    
    @CreationTimestamp
    private LocalDateTime createdAt;
    
    @UpdateTimestamp
    private LocalDateTime updatedAt;
    
    private LocalDateTime deletedAt;
    
    public void softDelete() {
        this.deletedAt = LocalDateTime.now();
    }
    
    public boolean isDeleted() {
        return deletedAt != null;
    }
}

@Entity
public class Appointment extends BaseEntity {
    // ...
}
```

**Option 2 — Repository auto-filter**

```java
public interface AppointmentRepository extends JpaRepository<Appointment, UUID> {
    @Query("SELECT a FROM Appointment a WHERE a.deletedAt IS NULL")
    List<Appointment> findAll(); // Override: auto-exclude deleted
    
    @Query("SELECT a FROM Appointment a WHERE a.id = :id AND a.deletedAt IS NULL")
    Optional<Appointment> findById(UUID id); // Override
}
```

Spring Data JPA sẽ auto-apply filter cho mỗi query.

**Option 3 — Hibernate @Where (automatic)**

```java
@Entity
@Where(clause = "deleted_at IS NULL")
public class Appointment extends BaseEntity {
    // ...
}
```

Hibernate tự động thêm `WHERE deleted_at IS NULL` vào mỗi query. Tiện, nhưng: mà quay lại cái deleted rows thì phải override `@Where` locally.

```java
// Query deleted appointments
@Query("SELECT a FROM Appointment a WHERE a.deletedAt IS NOT NULL")
List<Appointment> findDeleted();
```

---

## Khi nào dùng soft delete, khi nào hard delete?

**Soft delete khi:**
- Audit trail quan trọng (healthcare, finance)
- Undo là requirement
- Foreign key reference cần maintain
- Data retention policy (lưu deleted 6 tháng, sau đó hard delete)

**Hard delete khi:**
- GDPR (user yêu cầu "xóa hết data của tôi" → phải hard delete)
- Storage expensive (delete ngay để free space)
- Data không sensitive (log, temp data)

---

## Ví dụ HMS — appointment soft delete

```java
@Entity
@Where(clause = "deleted_at IS NULL")
public class Appointment extends BaseEntity {
    @ManyToOne
    private Doctor doctor;
    
    @ManyToOne
    private Patient patient;
    
    private LocalDateTime appointmentTime;
    private String status;
}

@Service
public class AppointmentService {
    @Transactional
    public void cancelAppointment(UUID appointmentId) {
        Appointment app = appointmentRepo.findById(appointmentId);
        if (app == null) throw new NotFound();
        
        app.softDelete(); // Set deleted_at = now
        appointmentRepo.save(app);
        
        // Audit log
        auditLog.log("CANCEL_APPOINTMENT", appointmentId, getCurrentUser());
        
        // Notification
        notificationService.sendCancellation(app.getPatient().getEmail());
    }
    
    public List<Appointment> getUpcomingAppointments(UUID patientId) {
        return appointmentRepo.findByPatientIdAndAppointmentTimeAfter(
            patientId, 
            LocalDateTime.now()
        );
        // @Where automatically exclude deleted
    }
}
```

---

## Takeaway

Soft delete nghe dễ (thêm một column), nhưng mỗi query phải care. Áp dụng @Where hoặc custom repository filter để auto-exclude deleted. Unique constraint phải partial index để avoid duplicate issues. Nếu không setup đúng, soft delete sẽ tư lừa bạn.

---

*Bài tiếp theo: Connection Pool — vì sao hàng ngàn request chỉ cần vài chục connection*
