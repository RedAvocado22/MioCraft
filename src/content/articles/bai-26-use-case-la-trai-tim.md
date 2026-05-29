---
title: "Use Case mới là trái tim thật sự của hệ thống"
description: "Không phải database, không phải framework, không phải API. Use case — hành động người dùng thực hiện — là thứ hệ thống thật sự tồn tại để phục vụ."
category: architecture
pubDate: 2024-01-26
series: "Phần 3: Kiến trúc phần mềm"
tags: ["architecture", "use-case", "clean-architecture"]
---

Có một câu hỏi tao hay dùng để đánh giá cách một developer suy nghĩ về kiến trúc: *"Hệ thống của mày làm gì?"*

Developer tư duy theo layer sẽ trả lời: "Có Controller, Service, Repository — Controller nhận request, Service xử lý, Repository lưu DB."

Developer tư duy theo domain sẽ trả lời: "Bệnh nhân có thể đặt lịch hẹn. Bác sĩ có thể xem lịch của mình. Admin có thể quản lý ca làm việc."

Câu trả lời thứ hai mô tả **use case** — những gì hệ thống thực sự làm từ góc nhìn của người dùng. Và đó mới là trái tim của hệ thống, không phải layer nào cả.

---

## Tại sao "Service" không phải là đơn vị tổ chức tốt

Trong Layered Architecture, đơn vị tổ chức code là layer: tất cả business logic nằm trong Service layer, tất cả data access nằm trong Repository layer. Cái tên mà mày đặt cho service thường là tên của entity: `AppointmentService`, `PatientService`, `DoctorScheduleService`.

Vấn đề: `AppointmentService` là một cái túi chứa *mọi thứ liên quan đến Appointment*. Đặt lịch, hủy lịch, xem lịch, tìm kiếm lịch, export báo cáo, kiểm tra conflict — tất cả nằm trong một class. Class đó không mô tả gì cụ thể ngoài "đây là nơi làm mọi thứ với Appointment."

Use Case khác. Mỗi use case mô tả một hành động cụ thể, từ góc nhìn của actor cụ thể:

```
BookAppointmentUseCase   — bệnh nhân đặt lịch
CancelAppointmentUseCase — bệnh nhân hoặc doctor hủy lịch
ConfirmAppointmentUseCase — doctor xác nhận lịch hẹn
RescheduleAppointmentUseCase — dời lịch sang slot khác
```

Mỗi use case là một class với một method duy nhất. Nó mô tả chính xác một flow từ đầu đến cuối.

---

## Use Case trông như thế nào trong thực tế

```java
// Một use case = một class = một flow
@Component
public class BookAppointmentUseCase {

    private final AppointmentStore appointmentStore;
    private final DoctorScheduleStore scheduleStore;
    private final PatientStore patientStore;
    private final ApplicationEventPublisher eventPublisher;

    // Constructor injection — dependencies rõ ràng, không có gì ẩn
    public BookAppointmentUseCase(
            AppointmentStore appointmentStore,
            DoctorScheduleStore scheduleStore,
            PatientStore patientStore,
            ApplicationEventPublisher eventPublisher) {
        this.appointmentStore = appointmentStore;
        this.scheduleStore = scheduleStore;
        this.patientStore = patientStore;
        this.eventPublisher = eventPublisher;
    }

    // Một method duy nhất — đây là toàn bộ flow
    public AppointmentResult execute(BookAppointmentCommand command) {
        Patient patient = patientStore.getById(command.getPatientId());
        DoctorSchedule schedule = scheduleStore.getById(command.getScheduleId());

        // Domain objects enforce business rules — use case chỉ orchestrate
        Appointment appointment = Appointment.book(patient, schedule);

        schedule.reserveSlot();

        appointmentStore.save(appointment);
        scheduleStore.save(schedule);

        eventPublisher.publishEvent(new AppointmentBookedEvent(appointment));

        return AppointmentResult.from(appointment);
    }
}
```

So sánh với `AppointmentService.bookAppointment()` — về mặt code có vẻ giống nhau. Nhưng sự khác biệt quan trọng là về **tổ chức**:

Khi mày đặt tên file là `BookAppointmentUseCase.java`, bất kỳ ai mở thư mục `usecases/` đều hiểu ngay hệ thống có thể làm gì mà không cần đọc một dòng code nào. Khi thêm một flow mới — ví dụ `RescheduleAppointmentUseCase` — mày tạo một file mới, không động vào code cũ. Khi `BookAppointmentUseCase` cần thêm logic phức tạp, nó không làm ảnh hưởng đến `CancelAppointmentUseCase`.

---

## Use Case tách Controller ra khỏi domain

Một trong những lợi ích quan trọng nhất của Use Case là nó làm cho Controller trở nên thực sự mỏng:

```java
@RestController
@RequestMapping("/appointments")
public class AppointmentController {

    private final BookAppointmentUseCase bookAppointmentUseCase;
    private final CancelAppointmentUseCase cancelAppointmentUseCase;

    @PostMapping
    public ResponseEntity<AppointmentResponse> book(@RequestBody @Valid BookingRequest request) {
        // Controller chỉ làm hai việc: parse HTTP input, delegate cho use case
        BookAppointmentCommand command = BookAppointmentCommand.from(request, userContext.getPatientId());
        AppointmentResult result = bookAppointmentUseCase.execute(command);
        return ResponseEntity.status(CREATED).body(AppointmentResponse.from(result));
    }

    @DeleteMapping("/{id}")
    public ResponseEntity<Void> cancel(@PathVariable UUID id) {
        cancelAppointmentUseCase.execute(new CancelAppointmentCommand(id, userContext.getUserId()));
        return ResponseEntity.noContent().build();
    }
}
```

Controller không có business logic. Không có validation phức tạp. Không có service gọi service. Nó chỉ làm một việc: chuyển đổi HTTP request thành command, gọi use case, chuyển đổi result thành HTTP response. Dễ đọc, dễ test, dễ thêm endpoint mới mà không lo side effect.

---

## Không phải mọi service đều nên thành Use Case

Nếu mày có một method đơn giản như `getAppointmentById()` — fetch by ID, map sang DTO, return — không cần tạo `GetAppointmentByIdUseCase`. Đó chỉ là query, không phải business flow. Query service hoặc repository trực tiếp là đủ.

Use Case xứng đáng với sự phức tạp khi có ít nhất một trong: nhiều domain object interact với nhau, side effects (notification, event, audit log), hoặc state transition phức tạp.

---

## Takeaway

Thử mở thư mục `service/` trong project của mày và đọc tên các class. Nếu tất cả đều là `XxxService` — mày biết có những entity nào, nhưng không biết hệ thống *làm gì*. Bây giờ tưởng tượng một thư mục `usecase/` với `BookAppointmentUseCase`, `CancelAppointmentUseCase`, `ConfirmAppointmentUseCase` — mày hiểu ngay hệ thống làm gì mà không cần đọc một dòng code nào.

---

*Bài tiếp theo: DTO vs Entity vs Domain Model — ba thứ khác nhau, và mày cần cả ba*
