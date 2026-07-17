---
title: "@Transactional sâu hơn — proxy, self-invocation, và rollback rules"
description: "Gọi this.save() trong cùng class không qua proxy — transaction không mở. Rollback chỉ với RuntimeException. Bug thầm lặng khiến data half-committed."
category: programming
pubDate: 2026-05-24
series: "Phần 6: Database"
tags: ["database", "transaction", "spring", "jpa"]
---


Bạn thêm `@Transactional` vào method `createAppointmentWithPayment()`. Bên trong gọi `saveAppointment()` và `chargePayment()` — cả hai đều có `@Transactional` riêng. Test unit xanh. Deploy. Một ngày payment gateway timeout giữa chừng: appointment đã lưu DB, payment chưa charge, patient nhận email xác nhận lịch hẹn.

Bạn mở code, thấy `@Transactional` đầy đủ. *"Ủa sao không rollback?"*

Vì Spring không wrap object bằng magic annotation trên method. Nó wrap **proxy**. Và `this.chargePayment()` không đi qua proxy.

---

## Spring @Transactional hoạt động bằng proxy, không phải annotation trên object

Khi application start, Spring tạo bean `AppointmentService` — thực ra là **proxy** bọc quanh instance thật:

```
Client → AppointmentServiceProxy → AppointmentServiceImpl
              ↑
         @Transactional ở đây mới có hiệu lực:
         - mở transaction
         - commit / rollback
         - propagation, isolation
```

Code trong controller inject `AppointmentService` — nhận proxy. Mọi call từ bên ngoài đi qua proxy → transaction hoạt động.

Nhưng bên **trong** class:

```java
@Service
public class AppointmentService {

  @Transactional
  public AppointmentResponse book(UUID slotId, UUID patientId) {
    var appointment = saveAppointment(slotId, patientId);  // this.saveAppointment()
    chargePayment(appointment);                             // this.chargePayment()
    return mapper.toResponse(appointment);
  }

  @Transactional
  public Appointment saveAppointment(UUID slotId, UUID patientId) {
    // ...
  }

  @Transactional
  public void chargePayment(Appointment appointment) {
  // ...
  }
}
```

`this.saveAppointment()` gọi **trực tiếp** method trên object thật — **bypass proxy**. Annotation `@Transactional` trên `saveAppointment` và `chargePayment` **không chạy** khi được gọi từ `book()` trong cùng class.

Chỉ có `@Transactional` trên `book()` — nếu có — mới bọc cả flow trong một transaction. Các annotation bên trong bị bỏ qua trong self-invocation.

Đây là bug **cực phổ biến** vì code trông đúng, IDE không cảnh báo, unit test mock repository không qua proxy nên vẫn pass.

---

## Cách sửa self-invocation

**Cách 1 — Một transaction ở method public ngoài cùng** (thường đủ):

```java
@Service
public class AppointmentService {

  @Transactional
  public AppointmentResponse book(UUID slotId, UUID patientId) {
    var appointment = doSaveAppointment(slotId, patientId);  // private, không cần @Transactional
    doChargePayment(appointment);
    return mapper.toResponse(appointment);
  }

  private Appointment doSaveAppointment(...) { ... }
  private void doChargePayment(...) { ... }
}
```

Logic con là `private` — chỉ entry point public mới có `@Transactional`.

**Cách 2 — Tách service** (khi boundary transaction = boundary domain):

```java
@Service
public class AppointmentBookingFacade {
  private final AppointmentService appointmentService;
  private final PaymentService paymentService;

  @Transactional
  public AppointmentResponse book(...) {
    var apt = appointmentService.save(...);   // call qua proxy khác bean
    paymentService.charge(apt);
    return ...;
  }
}
```

`PaymentService.charge()` có thể có propagation riêng (`REQUIRES_NEW`) nếu business yêu cầu — vì gọi **giữa các bean**, proxy hoạt động.

**Cách 3 — Self-inject** (ít dùng, dễ gây nhầm):

```java
@Autowired
@Lazy
private AppointmentService self;

public void book() {
  self.saveAppointment(); // đi qua proxy
}
```

Chỉ khi bạn hiểu rõ trade-off; tách service thường sạch hơn.

---

## Rollback rules — checked exception không rollback mặc định

```java
@Transactional
public void cancelAppointment(UUID id) throws AppointmentCancellationException {
  appointmentRepository.deleteById(id);
  notificationService.sendCancellation(id);
  if (someBusinessRule) {
    throw new AppointmentCancellationException("Không hủy được"); // checked
  }
}
```

Mặc định Spring **chỉ rollback** với `RuntimeException` và `Error`. **Checked exception không rollback** trừ khi bạn chỉ định:

```java
@Transactional(rollbackFor = Exception.class)
```

Hoặc ngược lại — không rollback với exception cụ thể:

```java
@Transactional(noRollbackFor = BusinessWarningException.class)
```

Bug kinh điển: throw checked exception sau khi đã `save()` — transaction commit, bạn tưởng đã rollback.

---

## propagation — mặc định REQUIRED

```java
@Transactional(propagation = Propagation.REQUIRED) // default
```

Đã có transaction → join. Chưa có → tạo mới.

`REQUIRES_NEW` — suspend transaction hiện tại, mở transaction mới — dùng cho audit log phải commit dù main flow fail:

```java
@Transactional(propagation = Propagation.REQUIRES_NEW)
public void writeAuditLog(...) { ... }
```

`NESTED` — savepoint trong transaction cha — ít dùng hơn trong JPA thuần.

Gọi nhầm propagation giữa các service có thể tạo **partial commit** — hiểu flow trước khi copy annotation từ Stack Overflow.

---

## readOnly, isolation, timeout

```java
@Transactional(readOnly = true)
public List<DoctorScheduleResponse> getAvailableSchedules(UUID doctorId, LocalDate date) {
  return scheduleRepository.findByDoctorIdAndDate(doctorId, date)
      .stream()
      .map(scheduleMapper::toResponse)
      .toList();
}
```

`readOnly = true` hint cho Hibernate: không flush dirty state, có thể optimize connection — dùng cho query-heavy path, không cho method vừa read vừa write.

`@Transactional` trên **private method** — **không hoạt động** (Spring AOP chỉ proxy public method của concrete class; interface-based JDK proxy càng strict). Đừng đặt trên private.

`@Transactional` trên **controller** — smell. Transaction boundary thuộc service layer — controller mỏng.

---

## Ví dụ HMS — notification sau commit

Gửi email trong `@Transactional` method: email API chậm → giữ DB connection lâu. Email fail → rollback cả appointment — có thể đúng hoặc sai tùy product.

Pattern đúng cho side effect sau khi data chắc chắn persist:

```java
@Transactional
public AppointmentResponse book(...) {
  var saved = appointmentRepository.save(appointment);
  return mapper.toResponse(saved);
  // không gửi email ở đây
}

@TransactionalEventListener(phase = TransactionPhase.AFTER_COMMIT)
public void onAppointmentBooked(AppointmentBookedEvent event) {
  notificationService.sendConfirmation(event.appointmentId());
}
```

Self-invocation không liên quan trực tiếp, nhưng cùng theme: **hiểu khi nào transaction thật sự commit** trước khi làm việc phụ thuộc vào nó.

---

## Takeaway

Trước khi tin `@Transactional` đã cứu bạn: vẽ call graph. Call từ bên ngoài bean → qua proxy. `this.foo()` trong cùng class → không qua proxy. Một entry point public bọc cả flow, hoặc tách bean. Và nhớ rollback mặc định bỏ qua checked exception — nếu business fail phải undo DB, throw `RuntimeException` hoặc `rollbackFor`.

---

*Bài tiếp theo: CORS — tại sao browser block và config đúng trong Spring.*
