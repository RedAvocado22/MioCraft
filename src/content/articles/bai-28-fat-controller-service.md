---
title: "Fat Controller, Fat Service — dấu hiệu kiến trúc đang sai"
description: "Service 2000 dòng là triệu chứng, không phải bệnh. Bệnh là không có ranh giới rõ ràng giữa các responsibility trong hệ thống."
category: architecture
pubDate: 2024-01-28
series: "Phần 3: Kiến trúc phần mềm"
tags: ["architecture", "anti-patterns", "refactoring"]
---

Có hai antipattern mà mày sẽ thấy trong hầu hết mọi codebase Spring Boot đủ lớn. Chúng trông khác nhau về triệu chứng nhưng cùng một nguyên nhân gốc rễ.

**Fat Controller**: Controller có hàng trăm dòng, chứa validation phức tạp, query database trực tiếp, gọi nhiều service khác nhau, và đưa ra quyết định nghiệp vụ thay vì delegate xuống dưới.

**Fat Service**: Service có hàng trăm dòng, inject năm đến bảy service khác, method dài năm mươi dòng, làm quá nhiều việc khác nhau trong cùng một class.

Cả hai đều xuất hiện vì cùng một lý do: không có quy tắc rõ ràng về *ai được làm gì*.

---

## Fat Controller — khi presentation layer nghĩ quá nhiều

```java
// ❌ Vấn đề: Controller đang làm việc của Service và Domain
@PostMapping("/appointments")
public ResponseEntity<?> bookAppointment(
        @RequestBody BookingRequest request,
        @AuthenticationPrincipal UserDetails userDetails) {

    // Validation phức tạp trong Controller — sai
    if (request.getScheduleId() == null) {
        return ResponseEntity.badRequest().body("Schedule ID required");
    }

    // Query database trực tiếp từ Controller — sai
    Optional<Patient> patientOpt = patientRepository.findByUserId(userDetails.getUserId());
    if (patientOpt.isEmpty()) {
        return ResponseEntity.status(403).body("Patient profile not found");
    }
    Patient patient = patientOpt.get();

    // Business decision trong Controller — rất sai
    List<Appointment> existing = appointmentRepository
        .findByPatientIdAndStatus(patient.getId(), CONFIRMED);
    if (!existing.isEmpty()) {
        return ResponseEntity.badRequest().body("Already has active appointment");
    }

    // Gọi service mới tính
    AppointmentResponse response = appointmentService.book(patient.getId(), request);
    return ResponseEntity.ok(response);
}
```

Vấn đề cụ thể: logic check `existing appointments` nằm trong Controller, nhưng cũng có thể nằm trong `AppointmentService.book()` nữa. Ai là source of truth? Khi rule thay đổi, sửa ở đâu?

Controller phụ thuộc trực tiếp vào `patientRepository` và `appointmentRepository` — test controller này đòi hỏi mock database, không chỉ mock service.

---

## Fat Service — khi business layer ôm đồm

```java
// ❌ Vấn đề: Service inject quá nhiều dependency
@Service
public class AppointmentService {

    @Autowired private AppointmentRepository appointmentRepository;
    @Autowired private PatientRepository patientRepository;
    @Autowired private DoctorScheduleRepository scheduleRepository;
    @Autowired private InsuranceService insuranceService;
    @Autowired private NotificationService notificationService;
    @Autowired private PaymentService paymentService;
    @Autowired private AuditService auditService;

    // Method dài 80 dòng làm tất cả mọi thứ
    public AppointmentResponse bookAppointment(UUID patientId, BookingRequest request) {
        Patient patient = patientRepository.findById(patientId).orElseThrow();
        DoctorSchedule schedule = scheduleRepository.findById(request.getScheduleId()).orElseThrow();

        // Validate insurance
        boolean covered = insuranceService.checkCoverage(patient.getInsuranceId(), request.getTreatmentCode());
        BigDecimal copay = insuranceService.calculateCopay(patient.getInsuranceId(), schedule.getConsultationFee());

        // Check slot
        if (schedule.getCurrentPatients() >= schedule.getMaxPatients()) throw ...;

        // Check existing appointments
        List<Appointment> existing = appointmentRepository.findByPatientAndStatus(patient, CONFIRMED);
        if (!existing.isEmpty()) throw ...;

        // Create appointment
        Appointment appointment = new Appointment();
        appointment.setPatient(patient);
        appointment.setSchedule(schedule);
        appointment.setStatus(PENDING);
        appointment.setCopay(copay);
        appointmentRepository.save(appointment);

        // Decrement slots
        schedule.setCurrentPatients(schedule.getCurrentPatients() + 1);
        scheduleRepository.save(schedule);

        // Send notifications
        notificationService.sendToPatient(patient, appointment);
        notificationService.sendToDoctor(schedule.getDoctor(), appointment);

        // Audit
        auditService.log("APPOINTMENT_BOOKED", patientId, appointment.getId());

        // Create payment record
        paymentService.createPendingPayment(appointment, copay);

        return mapper.toResponse(appointment);
    }
}
```

Số lượng dependency là dấu hiệu rõ ràng nhất. Bảy inject trong một class nghĩa là class đó đang phụ thuộc vào bảy nguồn thay đổi khác nhau. Khi `InsuranceService` thay đổi interface, `PaymentService` thêm method mới, `NotificationService` refactor — tất cả đều có thể kéo đến `AppointmentService`.

---

## Hướng trị liệu: thin controller, focused service

```java
// ✅ Controller chỉ làm việc của nó
@PostMapping("/appointments")
public ResponseEntity<AppointmentResponse> bookAppointment(
        @RequestBody @Valid BookAppointmentRequest request) {
    // Lấy patient ID từ security context — không query DB
    UUID patientId = SecurityContextHolder.getPatientId();
    AppointmentResponse result = bookAppointmentUseCase.execute(
        new BookAppointmentCommand(patientId, request.getScheduleId(), request.getTreatmentCode())
    );
    return ResponseEntity.status(CREATED).body(result);
}

// ✅ Use case orchestrate — nhưng delegate cho domain và sub-services chuyên biệt
@Component
public class BookAppointmentUseCase {

    // Chỉ inject những gì thực sự cần cho use case này
    private final AppointmentStore appointmentStore;
    private final DoctorScheduleStore scheduleStore;
    private final PatientStore patientStore;
    private final ApplicationEventPublisher eventPublisher;

    public AppointmentResult execute(BookAppointmentCommand command) {
        Patient patient = patientStore.getById(command.patientId());
        DoctorSchedule schedule = scheduleStore.getById(command.scheduleId());

        // Domain object tự enforce rule — use case không biết rule là gì
        Appointment appointment = Appointment.book(patient, schedule);
        schedule.reserveSlot();

        appointmentStore.save(appointment);
        scheduleStore.save(schedule);

        // Event thay vì gọi trực tiếp — NotificationService không bị kéo vào đây
        eventPublisher.publishEvent(new AppointmentBookedEvent(appointment.getId()));

        return AppointmentResult.from(appointment);
    }
}
```

Controller mỏng: parse HTTP, lấy identity từ security context, delegate, serialize response. Không có business logic.

Use Case tập trung: orchestrate flow booking — nhưng không biết cách gửi notification (event), không biết cách tính insurance (delegate sang domain), không inject 7 service.

---

## Takeaway

Đếm số `@Autowired` trong một service. Nếu trên bốn hoặc năm — đó là dấu hỏi, không phải điều bình thường. Hỏi: *"Service này đang làm mấy việc khác nhau? Và những việc đó có thực sự cùng thuộc một domain không?"*

---

*Bài tiếp theo: Framework là công cụ, không phải nền móng*
