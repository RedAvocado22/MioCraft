---
title: "Boolean flag — kẻ phá hoại thầm lặng"
description: "Boolean parameter trong function signature là mùi code rõ ràng nhất. Nó làm function làm hai việc và caller không hiểu đang gọi cái gì."
category: programming
pubDate: 2024-01-15
series: "Phần 2: Clean Code"
tags: ["clean-code", "boolean", "anti-patterns"]
---

Bạn đã bao giờ gặp một function call như này chưa:

```java
appointmentService.create(request, true, false, true);
```

Ba cái boolean. Mình không biết `true`, `false`, `true` nghĩa là gì nếu không nhảy vào xem signature. Và đây chỉ là lúc gọi hàm — còn bên trong hàm, những cái boolean đó được dùng để rẽ nhánh logic theo cách mà không ai còn nhớ nổi sau ba tuần.

Boolean flag là một trong những thứ làm code thoái hóa chậm nhất — vì nó ít khi gây bug ngay lập tức, nhưng tích lũy đủ lâu là hệ thống trở nên không ai dám đụng vào.

## Vấn đề 1: Boolean parameter

Boolean parameter là form tệ nhất. Bởi vì ở call site, `true` và `false` không nói lên điều gì.

```java
// ❌ Vấn đề — ba boolean parameter
public Appointment createAppointment(
    AppointmentRequest request,
    boolean sendNotification,
    boolean skipInsuranceCheck,
    boolean isEmergency
) { ... }

// Call site — không thể hiểu nếu không tra signature
appointmentService.createAppointment(request, true, false, true);
```

Có hai cách fix tùy vào tình huống.

**Cách 1: Named constant hoặc enum thay cho boolean**

```java
// ✅ Tốt hơn — enum express intent rõ hơn
public enum AppointmentType { REGULAR, EMERGENCY }
public enum InsuranceCheckPolicy { REQUIRED, SKIP }
public enum NotificationPolicy { SEND, SUPPRESS }

public Appointment createAppointment(
    AppointmentRequest request,
    AppointmentType type,
    InsuranceCheckPolicy insurancePolicy,
    NotificationPolicy notificationPolicy
) { ... }

// Call site bây giờ readable
appointmentService.createAppointment(
    request,
    AppointmentType.EMERGENCY,
    InsuranceCheckPolicy.SKIP,
    NotificationPolicy.SEND
);
```

**Cách 2: Tách thành nhiều method khi các trường hợp thực sự khác nhau**

```java
// ✅ Tốt hơn khi business logic thực sự khác nhau
public Appointment createRegularAppointment(AppointmentRequest request) { ... }
public Appointment createEmergencyAppointment(AppointmentRequest request) { ... }
```

Cách nào dùng khi nào? Nếu business logic trong hai trường hợp thực sự khác nhau đáng kể — tách method. Nếu chỉ là một vài điều kiện nhỏ — enum sẽ cleaner hơn.

## Vấn đề 2: Boolean field dùng để control flow

Đây là dạng tích lũy theo thời gian. Bắt đầu từ một field đơn giản:

```java
public class Appointment {
    private boolean isPaid;
}
```

Sau đó thêm feature:

```java
public class Appointment {
    private boolean isPaid;
    private boolean isConfirmed;
    private boolean isCancelled;
    private boolean isCompleted;
    private boolean isNoShow;
}
```

Và service bắt đầu nhìn như này:

```java
// ❌ Vấn đề — logic rẽ nhánh theo boolean combination
if (appointment.isConfirmed() && !appointment.isCancelled() && !appointment.isCompleted()) {
    // Gửi reminder
}

if (!appointment.isPaid() && appointment.isConfirmed() && !appointment.isCancelled()) {
    // Nhắc thanh toán
}

if (appointment.isCancelled() && appointment.isPaid()) {
    // Refund
}
```

Có bao nhiêu trạng thái valid? Bạn có thể có `isConfirmed=true` và `isCancelled=true` cùng lúc không? Không ai biết. Và khi thêm feature mới, dev không biết boolean nào nên set là `true`, boolean nào nên `false`.

Fix đúng là dùng enum để model state machine:

```java
// ✅ Tốt hơn — explicit state machine
public enum AppointmentStatus {
    PENDING,       // Đã đặt, chưa confirm
    CONFIRMED,     // Đã confirm, chờ khám
    IN_PROGRESS,   // Đang khám
    COMPLETED,     // Khám xong
    CANCELLED,     // Đã hủy
    NO_SHOW        // Bệnh nhân không đến
}

public class Appointment {
    private AppointmentStatus status;
    private boolean isPaid; // Giữ lại vì payment orthogonal với status
}
```

Bây giờ logic trở nên rõ ràng:

```java
// ✅ Rõ ràng về ý định
if (appointment.getStatus() == CONFIRMED) {
    reminderService.scheduleReminder(appointment);
}

if (!appointment.isPaid() && appointment.getStatus() == CONFIRMED) {
    paymentReminderService.send(appointment);
}

if (appointment.getStatus() == CANCELLED && appointment.isPaid()) {
    refundService.initiateRefund(appointment);
}
```

P05/Bài 03 sẽ đi sâu hơn về Strategy vs State pattern trong context này — nhưng enum là bước đầu tiên và thường là đủ.

## Vấn đề 3: Boolean để control branching trong method

```java
// ❌ Vấn đề — boolean flag làm method không thể predict được
public List<Appointment> getAppointments(Long doctorId, boolean includeCompleted) {
    if (includeCompleted) {
        return appointmentRepository.findByDoctorId(doctorId);
    } else {
        return appointmentRepository.findByDoctorIdAndStatusNot(
            doctorId, AppointmentStatus.COMPLETED
        );
    }
}
```

Function này thực ra là hai function khác nhau được nhét vào một. Và ở call site, bạn sẽ thấy `getAppointments(doctorId, true)` và `getAppointments(doctorId, false)` — không ai nhớ cái nào là cái nào.

```java
// ✅ Tốt hơn — hai method rõ ràng
public List<Appointment> getActiveAppointmentsByDoctor(Long doctorId) {
    return appointmentRepository.findByDoctorIdAndStatusNot(
        doctorId, AppointmentStatus.COMPLETED
    );
}

public List<Appointment> getAllAppointmentsByDoctor(Long doctorId) {
    return appointmentRepository.findByDoctorId(doctorId);
}
```

## Dấu hiệu nhận biết

Bạn đang dùng boolean flag sai khi:

- Phải tra signature để hiểu `true` hay `false` nghĩa là gì tại call site
- Function có behavior hoàn toàn khác nhau tùy vào một boolean parameter
- Một class có nhiều hơn hai boolean field liên quan đến nhau
- Logic check nhiều boolean cùng lúc để quyết định hành động

Không phải mọi boolean đều là vấn đề. `isActive`, `isVerified`, `hasInsurance` — các field boolean độc lập nhau và rõ ràng — hoàn toàn ổn. Vấn đề xuất hiện khi boolean được dùng để control flow phức tạp hoặc đại diện cho trạng thái có nhiều hơn hai khả năng ẩn bên trong.

## Takeaway

Scan qua các method signature trong HMS, tìm bất kỳ cái nào có boolean parameter. Với mỗi cái, thử mô tả lại call site mà không cần nhìn vào signature — nếu bạn không thể, đó là candidate để refactor.

---

*Bài tiếp theo: Magic number — bug không có tên nhưng rất khó sửa*
