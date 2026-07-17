---
title: "Builder Pattern — khi constructor bắt đầu nhận 8 tham số"
description: "Constructor có 8 tham số không tên — đây là dấu hiệu Builder Pattern cần xuất hiện. Từ Java thuần đến Lombok @Builder, cách tổ chức object creation đúng trong Spring Boot."
category: programming
pubDate: 2024-04-16
series: "Phần 5: Design Patterns"
tags: ["design-patterns", "builder", "java", "lombok"]
---

---

Có một dấu hiệu rất rõ ràng mà bạn thường bỏ qua cho đến khi quá muộn: constructor của bạn đang nhận quá nhiều tham số.

```java
// ❌ Vấn đề — bạn đang nhìn vào cái này và không biết tham số nào là gì
Appointment appointment = new Appointment(
    doctorId, patientId, scheduleId, LocalDate.now(),
    "10:00", AppointmentStatus.PENDING, false, null
);
```

Câu hỏi tự nhiên là: `false` là gì? `null` là gì? Bạn phải nhảy vào class `Appointment` để đọc constructor mới biết. Và nếu bạn truyền nhầm thứ tự hai UUID — compiler không báo lỗi vì cả hai đều là `UUID`.

Builder Pattern sinh ra để giải quyết chính xác vấn đề này.

---

## Vấn đề thật sự không phải là số lượng tham số

Khi mọi người nói "constructor có quá nhiều tham số là bad practice", họ không nói về con số. Họ nói về hai thứ cụ thể hơn:

**Thứ nhất là ambiguity.** Khi nhìn vào `new Appointment(id1, id2, id3, ...)`, không có context nào cho bạn biết `id1` là `doctorId` hay `patientId`. Code trở thành đố vui.

**Thứ hai là optional parameters.** Trong Java, không có named parameters hay default values như Python hay Kotlin. Nếu một field có thể null, bạn vẫn phải truyền `null` vào constructor — hoặc tạo ra năm overload khác nhau. Cả hai đều tệ.

Builder giải quyết cả hai bằng cách biến construction thành một chuỗi method calls có tên rõ ràng.

---

## Builder trông như thế nào trong thực tế

Trong HMS, `Appointment` được tạo ra ở nhiều nơi: từ booking flow, từ admin tạo thủ công, từ import lịch cũ. Mỗi nơi cần một tập fields khác nhau, một số field là optional.

```java
// ✅ Tốt hơn — đọc như prose, không cần nhảy vào class để hiểu
Appointment appointment = Appointment.builder()
    .doctorId(doctorId)
    .patientId(patientId)
    .scheduleId(scheduleId)
    .appointmentDate(LocalDate.now())
    .timeSlot("10:00")
    .status(AppointmentStatus.PENDING)
    .build();
```

Không còn ambiguity. Không còn `false` lơ lửng không biết là gì. Và nếu bạn bỏ qua một optional field — không cần truyền `null`.

Nếu bạn dùng Lombok (và trong Spring Boot project hầu như ai cũng dùng), cái này free hoàn toàn:

```java
@Builder
@Getter
public class Appointment {
    private UUID doctorId;
    private UUID patientId;
    private UUID scheduleId;
    private LocalDate appointmentDate;
    private String timeSlot;
    private AppointmentStatus status;
    
    // Optional — có default value
    @Builder.Default
    private boolean isRescheduled = false;
    
    @Builder.Default
    private String notes = "";
}
```

`@Builder` annotation generate toàn bộ builder class cho bạn. `@Builder.Default` handle default values — field nào không được set sẽ dùng giá trị mặc định thay vì `null`.

---

## Khi nào Builder thực sự cần, khi nào thì không

Builder không phải pattern bạn dùng cho mọi class. Có một ngưỡng khá rõ ràng:

**Dùng Builder khi:**
- Object có từ 4-5 fields trở lên cần set lúc construction
- Một số fields là optional với default values khác nhau
- Object cần immutable sau khi tạo (không có setter)
- Object được tạo ở nhiều nơi với tập fields khác nhau

**Không cần Builder khi:**
- Class chỉ có 2-3 fields — constructor bình thường đủ dùng
- Bạn đang dùng JPA Entity — Hibernate cần no-arg constructor và có setter riêng
- Object có lifecycle phức tạp hơn chỉ là "tạo ra và dùng"

Đây là lý do tại sao trong HMS, `Appointment` (domain object) dùng Builder, còn `AppointmentEntity` (JPA entity) thì không.

---

## Builder kết hợp với validation

Một điểm mạnh ít ai dùng: Builder là nơi hoàn hảo để đặt validation logic.

```java
@Builder
public class AppointmentCreateRequest {
    @NotNull private UUID doctorId;
    @NotNull private UUID patientId;
    private LocalDate appointmentDate;
    private String timeSlot;

    // Custom builder để validate trước khi tạo object
    public static class AppointmentCreateRequestBuilder {
        public AppointmentCreateRequest build() {
            if (appointmentDate != null && appointmentDate.isBefore(LocalDate.now())) {
                // ❌ Không cho tạo appointment với ngày trong quá khứ
                throw new IllegalArgumentException("Appointment date cannot be in the past");
            }
            return new AppointmentCreateRequest(doctorId, patientId, appointmentDate, timeSlot);
        }
    }
}
```

Thay vì để validation nằm rải rác trong Service, bạn đảm bảo rằng một `AppointmentCreateRequest` invalid không bao giờ được tạo ra. Đây là fail-fast — bắt lỗi sớm nhất có thể trong lifecycle của object.

---

## Builder vs static factory method

Có một pattern thường bị nhầm lẫn với Builder: static factory method.

```java
// Static factory — vẫn có vấn đề ordering nếu nhiều params
Appointment appointment = Appointment.of(doctorId, patientId, scheduleId);

// Builder — explicit, không có ordering issue
Appointment appointment = Appointment.builder()
    .doctorId(doctorId)
    .patientId(patientId)
    .scheduleId(scheduleId)
    .build();
```

Static factory method tốt cho trường hợp ít params và tên method nói rõ ý nghĩa (`Appointment.fromReschedule(originalId, newScheduleId)`). Builder tốt hơn khi params nhiều và cần flexibility.

Không có cái nào "đúng hơn" — bạn chọn dựa trên context.

---

## Takeaway

Lần tới khi bạn viết constructor nhận quá 4 tham số, dừng lại và hỏi: *"Người đọc call site này sau 3 tháng có biết tham số nào là gì không?"* Nếu không chắc — Builder là câu trả lời đúng, và với Lombok thì chi phí là zero.

---

*Bài tiếp theo: Database Migration với Flyway — vì sao schema thay đổi mà không có migration là đang chơi với lửa.*
