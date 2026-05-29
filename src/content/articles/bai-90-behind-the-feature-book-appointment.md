---
title: 'Behind the feature — nút "Book Appointment" ẩn chứa bao nhiêu hệ thống phía sau'
description: "Từ góc nhìn của bệnh nhân, đặt lịch khám rất đơn giản: chọn bác sĩ, chọn ngày, chọn giờ, bấm xác nhận. Bốn bước. Mười lăm giây."
category: system-design
pubDate: 2024-04-08
series: "Phần 10: Code Sống Sót"
---

Từ góc nhìn của bệnh nhân, đặt lịch khám rất đơn giản: chọn bác sĩ, chọn ngày, chọn giờ, bấm xác nhận. Bốn bước. Mười lăm giây.

Nhưng bấm cái nút đó trigger một chuỗi operations trải dài qua nhiều layer, nhiều service, nhiều concern — mỗi thứ phải xử lý đúng, theo đúng thứ tự, với đúng guarantees. Phần 10 của series này thực ra là câu chuyện về những gì xảy ra phía sau cái nút đó — từng mảnh được tách ra thành bài riêng.

Bài này ghép lại toàn bộ picture.

---

## Flow đầy đủ khi bệnh nhân bấm "Book Appointment"

```
Client
  │
  ├─ GET /schedules?doctorId=X&date=Y
  │    └─ [Cache layer] Redis → DB fallback
  │         └─ DoctorScheduleService.getAvailableSchedules()
  │
  ├─ [User chọn slot]
  │
  └─ POST /appointments
       └─ Header: Idempotency-Key: <uuid>
       └─ Body: { scheduleId, patientId, ... }
```

Khi request `POST /appointments` đến server, đây là những gì thực sự xảy ra:

---

## Layer 1: Authentication & Authorization

```java
// Keycloak JWT filter chạy trước mọi thứ
// Validate token signature, expiry, issuer
// Extract userId, role, claims → populate SecurityContext

// @PreAuthorize check role
@PreAuthorize("hasAnyRole('PATIENT', 'RECEPTIONIST')")
@PostMapping("/appointments")
public ResponseEntity<AppointmentResponse> createAppointment(
    @RequestBody AppointmentRequest request,
    @RequestHeader("Idempotency-Key") String idempotencyKey
) { ... }
```

Request không có valid JWT → 401 trước khi chạm vào business logic.

Request có JWT nhưng sai role → 403 tại `@PreAuthorize`.

---

## Layer 2: Idempotency Check

```java
// Check Redis trước (fast path)
// Check DB nếu Redis miss (safety net)
// Nếu key đã tồn tại → trả về response cũ, không process tiếp
```

Tại sao ở đây? Vì idempotency check cần xảy ra **trước** bất kỳ operation nào có side effect. Nếu mày check idempotency sau khi đã lock slot, và sau đó trả về "đã xử lý rồi" — mày đã lock một slot không cần thiết.

*(Chi tiết implementation: Bài 84)*

---

## Layer 3: ABAC — Patient chỉ được đặt lịch cho chính mình

```java
// PatientAccessPolicy.assertCanBookForPatient()
// Patient chỉ được đặt với patientId = chính họ
// Receptionist có thể đặt cho bất kỳ patient nào
accessPolicy.assertCanBookForPatient(
    userContext.getCurrentUserId(),
    userContext.getCurrentUserRole(),
    request.getPatientId()
);
```

Không có check này, bất kỳ patient nào cũng có thể đặt lịch dưới tên người khác — chỉ cần biết patientId.

*(Chi tiết implementation: Bài 86)*

---

## Layer 4: Atomic Slot Reservation — Redis Lua

```java
// Đây là điểm không thể có race condition
// Lua script chạy atomic: check capacity + increment counter
Long slotResult = redisTemplate.execute(
    bookingLuaScript,
    List.of("slot:schedule:" + request.getScheduleId()),
    String.valueOf(schedule.getMaxPatients())
);

if (slotResult == -1) {
    throw new SlotFullException("No available slots");
}
// Slot đã được "hold" trong Redis
```

Hai bệnh nhân cùng bấm Book cùng lúc → chỉ một người "hold" được slot. Người kia nhận SlotFullException ngay lập tức.

*(Chi tiết implementation: Bài 83)*

---

## Layer 5: Business Validation

```java
// Các check không cần atomic:
// - Schedule còn active không?
// - Patient không có appointment khác trong cùng timeframe?
// - Doctor có available không (không bị block lịch)?
// - Appointment date trong tương lai?

validateScheduleIsActive(schedule);
validateNoConflictingAppointment(request.getPatientId(), schedule);
validateDoctorAvailability(schedule.getDoctor(), schedule.getDate());
```

Những check này không cần atomic vì chúng không có side effect. Fail ở đây → release Redis slot (compensation).

---

## Layer 6: Persist to Database

```java
// Transaction bắt đầu ở đây
@Transactional
void persistAppointment(...) {
    Appointment appointment = Appointment.builder()
        .schedule(schedule)
        .patient(patient)
        .status(AppointmentStatus.CONFIRMED)
        .build();

    appointmentRepository.save(appointment);

    // Update schedule counter
    schedule.setCurrentPatients(schedule.getCurrentPatients() + 1);
    scheduleRepository.save(schedule);

    // Publish event — chỉ fire AFTER_COMMIT
    eventPublisher.publishEvent(new AppointmentCreatedEvent(appointment));

    // Lưu idempotency record
    saveIdempotencyRecord(idempotencyKey, userId, appointment.getId());
}
```

---

## Layer 7: Post-commit Side Effects

Sau khi transaction commit thành công, `@TransactionalEventListener` fire:

```java
@TransactionalEventListener(phase = TransactionPhase.AFTER_COMMIT)
@Transactional(propagation = Propagation.REQUIRES_NEW)
void handleAppointmentCreated(AppointmentCreatedEvent event) {
    // Gửi SMS/email confirmation cho bệnh nhân
    notificationService.sendAppointmentConfirmation(event.getAppointment());

    // Invalidate cache liên quan
    cacheInvalidationService.invalidateScheduleCache(event.getScheduleId());

    // Log audit trail
    auditService.logAppointmentCreated(event.getAppointment(), userContext.getCurrentUserId());
}
```

*(Chi tiết: Bài 85 cho notification, Bài 88 cho cache invalidation)*

---

## Toàn bộ picture

```
POST /appointments
    │
    ├─ 1. JWT Validation (Keycloak filter)
    ├─ 2. Role Check (@PreAuthorize)
    ├─ 3. Idempotency Check (Redis + DB)
    ├─ 4. ABAC Policy (PatientAccessPolicy)
    ├─ 5. Atomic Slot Hold (Redis Lua)
    ├─ 6. Business Validation
    ├─ 7. DB Transaction (save Appointment + update Schedule)
    │       └─ Publish AppointmentCreatedEvent
    │
    └─ [AFTER_COMMIT]
            ├─ 8. Send Notification (SMS + Email)
            ├─ 9. Invalidate Schedule Cache
            └─ 10. Write Audit Log
```

Mỗi layer có một concern rõ ràng. Fail ở bất kỳ layer nào có compensation rõ ràng. Side effects chỉ xảy ra sau khi core transaction chắc chắn thành công.

---

## Điều mà flow này dạy về software design

Nhìn vào 10 bước trên, dễ thấy một pattern: mỗi concern được tách ra thành một layer riêng biệt, với boundary rõ ràng.

Đây không phải over-engineering. Đây là kết quả của việc hỏi đúng câu hỏi trước khi viết code:

- *Điều gì xảy ra nếu hai request đến cùng lúc?* → Redis Lua atomic
- *Điều gì xảy ra nếu request được gửi lại?* → Idempotency
- *Điều gì xảy ra nếu DB fail sau khi notification đã gửi?* → AFTER_COMMIT listener
- *Điều gì xảy ra nếu patient cố đặt lịch cho người khác?* → ABAC policy

Từng câu hỏi đó, nếu không được hỏi, tạo ra một lỗ hổng trong hệ thống. Và những lỗ hổng đó không xuất hiện trong happy path test. Chúng xuất hiện trên production, lúc hệ thống đang chịu tải thật, với user thật, làm những thứ mày không expect.

Senior dev không giỏi hơn junior vì họ code nhanh hơn hay biết nhiều API hơn. Họ giỏi hơn vì họ đã thấy đủ edge cases để biết cần hỏi những câu hỏi đó từ đầu.

---

## Takeaway

Lần tới khi mày nhận một feature requirement — dù đơn giản đến đâu — hãy trace qua toàn bộ flow và hỏi về từng failure mode. Không phải để over-engineer, mà để biết mình đang accept risk gì và risk nào cần được address ngay. Một cái nút "Book Appointment" là đơn giản với user. Nhưng code phía sau xứng đáng được thiết kế nghiêm túc.

---

*Phần tiếp theo: Product-minded thinking — Dev làm task. Product engineer hỏi tại sao task này tồn tại*
