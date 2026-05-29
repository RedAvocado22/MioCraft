---
title: "DTO vs Entity vs Domain Model — ba thứ khác nhau, và mày cần cả ba"
description: "Dùng Entity làm DTO, hay Domain Model làm Entity — đây là sai lầm phổ biến nhất trong Spring Boot và nó phá vỡ boundary một cách thầm lặng."
category: architecture
pubDate: 2024-01-27
series: "Phần 3: Kiến trúc phần mềm"
tags: ["architecture", "DTO", "domain-model", "spring-boot"]
---

Đây là một trong những thứ mà mày sẽ thấy bị conflict nhất khi đọc code người khác: cùng một cái tên "Appointment" nhưng có thể có đến ba, bốn version khác nhau trong cùng một project — `Appointment`, `AppointmentDTO`, `AppointmentRequest`, `AppointmentResponse`, `AppointmentEntity`. Đôi khi còn có `AppointmentVO`.

Một developer nhìn vào đống đó sẽ bực bội: *"Sao nhiều class thế? Gộp lại một cái cho đơn giản không?"*

Câu trả lời là không — và hiểu tại sao sẽ giúp mày tránh được một loạt bug tinh vi mà hầu hết junior mắc phải.

---

## Ba đối tượng, ba mục đích

**Domain Model** (hay Domain Object) là nơi business logic sống. Nó biểu diễn một khái niệm nghiệp vụ — không phải "row trong database" và không phải "JSON payload." `Appointment` là một domain model: nó có state machine, có invariants, có methods thực thi business rule.

**Entity** (hay Persistence Model) là cách domain model được lưu vào database. Nó quan tâm đến JPA annotation, foreign key, lazy loading, table name. Đây là công cụ của infrastructure — không phải business.

**DTO** (Data Transfer Object) là hình dạng của data khi di chuyển qua ranh giới hệ thống — vào ra HTTP, vào ra queue, vào ra file. Nó flat, không có behavior, chỉ có data.

---

## Khi mày merge ba thứ này thành một

```java
// ❌ Vấn đề: một class làm cả ba việc
@Entity
@Table(name = "appointments")
public class Appointment {

    @Id
    @GeneratedValue(strategy = GenerationType.UUID)
    private UUID id;

    // JPA relationship — mày cần @JsonIgnore vì serialization sẽ load lazy relation
    @ManyToOne(fetch = FetchType.LAZY)
    @JsonIgnore  // ← đây là dấu hiệu conflict: phải dùng Jackson annotation trong domain
    private Patient patient;

    // Exposed ra API luôn — bao gồm cả field nhạy cảm
    private String internalNotes; // bác sĩ viết, không nên trả về cho patient

    // DTO field — chỉ dùng khi tạo mới, không có trong DB
    @Transient
    private String insuranceCode; // ← @Transient là dấu hiệu đây không thuộc về entity

    // Business method
    public void cancel() { ... }

    // Setter mở toàn bộ — cần vì JPA, nhưng phá vỡ encapsulation của domain
    public void setStatus(AppointmentStatus status) {
        this.status = status; // không validate gì cả
    }
}
```

Hậu quả ngay lập tức:

Mày phải đánh `@JsonIgnore` trên JPA relationship vì Jackson sẽ trigger lazy load khi serialize — và nếu quên, mày nhận được `LazyInitializationException` hoặc tệ hơn là serialize cả object graph. Domain class của mày phải biết về JSON. Không đúng.

Field `internalNotes` xuất hiện trong response trả về cho bệnh nhân trừ khi mày nhớ exclude nó. Với đủ loại field nhạy cảm, mày sẽ sớm có security leak mà không hay.

JPA yêu cầu public setter — nhưng setter đó phá vỡ encapsulation. Ai cũng có thể gọi `appointment.setStatus(COMPLETED)` mà không đi qua business rule.

---

## Tách ra trông như thế nào

```java
// Domain Model — business logic, không biết JPA, không biết JSON
public class Appointment {

    private final UUID id;
    private final UUID patientId;   // chỉ lưu ID, không phải object
    private AppointmentStatus status;
    private String internalNotes;   // private, không exposed ra ngoài tùy tiện

    // Factory method thay vì constructor mở
    public static Appointment create(UUID patientId, UUID scheduleId) { ... }

    // Business rule được enforce — không có setter mở
    public void cancel(UUID requestedByUserId) {
        if (this.status == COMPLETED) throw new InvalidTransitionException("...");
        if (!this.patientId.equals(requestedByUserId)) throw new UnauthorizedException("...");
        this.status = CANCELLED;
    }
}

// Persistence Entity — chỉ biết về DB
@Entity
@Table(name = "appointments")
class AppointmentJpaEntity {
    @Id UUID id;
    UUID patientId;
    UUID scheduleId;
    @Enumerated(EnumType.STRING) AppointmentStatus status;
    String internalNotes;

    static AppointmentJpaEntity from(Appointment domain) { ... }
    Appointment toDomain() { ... }
}

// Response DTO — shape cho patient API
public record AppointmentResponse(
    UUID id,
    String doctorName,
    LocalDate date,
    int slot,
    AppointmentStatus status
    // internalNotes không có ở đây — không bao giờ leak ra patient
) {
    static AppointmentResponse from(Appointment domain, DoctorInfo doctorInfo) { ... }
}

// Request DTO — input từ HTTP
public record BookAppointmentRequest(
    @NotNull UUID scheduleId,
    @NotNull String insuranceCode
) {}
```

Ba class, ba trách nhiệm rõ ràng. Thay đổi DB schema không ảnh hưởng Domain. Thay đổi API response không ảnh hưởng business rule. Business rule không bị ảnh hưởng bởi việc mày đang dùng REST hay gRPC.

---

## Khi nào không cần tách

Tách ra có cost — thêm code, thêm mapping, thêm class. Với CRUD đơn giản (Patient basic info, Employee record), dùng JPA entity trực tiếp làm DTO là trade-off chấp nhận được, đặc biệt ở giai đoạn đầu.

Nhưng khi một object có business rules thật sự, state machine, hoặc security requirement — tách là cần thiết, không phải optional.

---

## Takeaway

Mỗi khi mày thấy `@JsonIgnore` hay `@Transient` trong một JPA entity, đó là dấu hiệu hai trách nhiệm đang conflict trong cùng một class. Hỏi: *"Annotation này có mặt ở đây vì business rule, hay vì ai đó đang cố workaround một conflict?"*

---

*Bài tiếp theo: Fat Controller, Fat Service — dấu hiệu kiến trúc đang sai*
