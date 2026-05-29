---
title: "Domain logic không được biết database tồn tại"
description: "Khi domain model import JPA annotation — kiến trúc đã bị vi phạm. Business rule không nên biết data được lưu ở đâu hay như thế nào."
category: architecture
pubDate: 2024-01-25
series: "Phần 3: Kiến trúc phần mềm"
tags: ["architecture", "domain-driven-design", "clean-architecture"]
---

Đây là một câu hỏi mà hầu hết developer không bao giờ nghĩ đến: *tại sao business logic lại cần biết mày đang dùng MySQL?*

Quy tắc "bệnh nhân không thể đặt lịch nếu có appointment đang confirmed" không có gì liên quan đến MySQL. Nó cũng không liên quan đến PostgreSQL, MongoDB, hay Redis. Đó là quy tắc của bệnh viện — tồn tại độc lập với mọi infrastructure decision mày đưa ra. Nhưng trong hầu hết codebase Spring Boot, business logic và database bị tie chặt với nhau đến mức mày không thể test một cái mà không cần cái kia.

---

## JPA annotations đang làm gì với domain của mày

Nhìn vào một entity HMS điển hình:

```java
@Entity
@Table(name = "appointments")
public class Appointment {

    @Id
    @GeneratedValue(strategy = GenerationType.UUID)
    private UUID id;

    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "patient_id")
    private Patient patient;

    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "doctor_schedule_id")
    private DoctorSchedule schedule;

    @Enumerated(EnumType.STRING)
    private AppointmentStatus status;

    // business methods...
    public void cancel() {
        if (this.status == AppointmentStatus.COMPLETED) {
            throw new IllegalStateException("Cannot cancel a completed appointment");
        }
        this.status = AppointmentStatus.CANCELLED;
    }
}
```

Class này đang làm hai việc cùng lúc. Nó là **domain object** — chứa rule nghiệp vụ như `cancel()`. Và nó đồng thời là **JPA entity** — `@Entity`, `@Table`, `@JoinColumn` là những annotation cho Hibernate biết cách map object này sang database.

Vấn đề không phải là sự kết hợp đó sai về mặt kỹ thuật. Trong nhiều trường hợp, nó là trade-off chấp nhận được. Vấn đề là **domain object giờ đây phụ thuộc vào JPA** — mày không thể instantiate `Appointment` trong unit test mà không load Spring context, không có Hibernate, không có database.

Thử test method `cancel()`:

```java
// Phải setup JPA context chỉ để test một rule đơn giản
@SpringBootTest  // load toàn bộ Spring context
@Transactional
class AppointmentTest {
    
    @Autowired
    private AppointmentRepository repository;
    
    @Test
    void shouldNotCancelCompletedAppointment() {
        // Phải tạo data trong DB, load lại, rồi mới test
        Appointment appointment = createAndSaveCompletedAppointment();
        assertThrows(IllegalStateException.class, () -> appointment.cancel());
    }
}
```

So với nếu domain logic tách khỏi persistence:

```java
// Không cần Spring, không cần database, không cần mock gì cả
class AppointmentTest {
    
    @Test
    void shouldNotCancelCompletedAppointment() {
        Appointment appointment = new Appointment(UUID.randomUUID(), COMPLETED);
        assertThrows(IllegalStateException.class, () -> appointment.cancel());
    }
}
```

Cái thứ hai chạy trong milliseconds. Cái đầu chạy trong giây — vì phải boot Spring, kết nối DB, run migrations. Nhân lên cho 500 test cases, mày có một CI pipeline mất 15 phút.

---

## Separation thực tế trông như thế nào

Không cần đi đến extreme của Clean Architecture với nhiều lớp abstraction. Một bước nhỏ đủ tạo ra sự khác biệt lớn:

```java
// Domain object — không có JPA annotation
public class Appointment {
    private final UUID id;
    private final UUID patientId;
    private final UUID scheduleId;
    private AppointmentStatus status;

    public static Appointment create(UUID patientId, UUID scheduleId) {
        return new Appointment(UUID.randomUUID(), patientId, scheduleId, PENDING);
    }

    public void confirm() {
        if (this.status != PENDING) {
            throw new InvalidTransitionException("Can only confirm PENDING appointments");
        }
        this.status = CONFIRMED;
    }

    public void cancel() {
        if (this.status == COMPLETED) {
            throw new InvalidTransitionException("Cannot cancel a completed appointment");
        }
        this.status = CANCELLED;
    }
}

// JPA entity riêng biệt — chỉ lo việc mapping
@Entity
@Table(name = "appointments")
class AppointmentJpaEntity {

    @Id
    private UUID id;
    private UUID patientId;
    private UUID scheduleId;

    @Enumerated(EnumType.STRING)
    private AppointmentStatus status;

    // Conversion methods
    static AppointmentJpaEntity from(Appointment appointment) { ... }
    Appointment toDomain() { ... }
}
```

Hai class, hai trách nhiệm. `Appointment` là domain object thuần túy — có thể test mà không cần Spring. `AppointmentJpaEntity` là mapping layer — biết về database, nhưng không chứa business logic.

---

## Khi nào nên và không nên làm vậy

Cách tiếp cận này có chi phí: thêm code, thêm conversion logic, thêm class cần maintain. Với một CRUD đơn giản — tạo patient, lấy danh sách, update tên — chi phí đó không xứng đáng.

Nhưng với những aggregate phức tạp như `Appointment` — có state machine, có nhiều rule nghiệp vụ, cần test nhiều transition — tách domain khỏi persistence là đầu tư xứng đáng. Nó cho phép mày test toàn bộ business logic trong milliseconds, và đảm bảo rằng khi database schema thay đổi, domain logic không bị kéo theo.

---

## Takeaway

Mỗi khi mày viết một business rule trong một class có `@Entity`, hỏi: *"Rule này cần biết mày đang dùng MySQL không?"* Nếu không — nó thuộc về domain object, không phải JPA entity.

---

*Bài tiếp theo: Use Case mới là trái tim thật sự của hệ thống*
