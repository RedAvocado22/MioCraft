---
title: "Đừng nuốt lỗi — hệ thống sẽ trả giá thay mày"
description: "catch (Exception e) {} là một trong những đoạn code nguy hiểm nhất có thể tồn tại. Lỗi bị ẩn đi, hệ thống tiếp tục chạy sai mà không ai hay."
category: programming
pubDate: 2024-01-17
series: "Phần 2: Clean Code"
tags: ["clean-code", "error-handling", "exceptions"]
---

Đây là một trong những loại bug khó nhất để debug trong production: hệ thống chạy bình thường, không có exception, không có log error — nhưng data bị sai. Bệnh nhân đặt lịch thành công nhưng appointment không có trong database. Thanh toán được confirm nhưng trạng thái vẫn là PENDING.

Phần lớn những trường hợp như vậy đều có chung một nguyên nhân: có exception đã xảy ra ở đâu đó, và ai đó đã nuốt nó.

## Nuốt lỗi trông như thế nào

```java
// ❌ Classic nuốt lỗi — catch rồi không làm gì
try {
    insuranceService.verify(appointment.getPatientId());
} catch (Exception e) {
    // TODO: handle this
}

// ❌ Cũng là nuốt lỗi — log xong bỏ qua như chưa có chuyện gì
try {
    notificationService.sendConfirmation(appointment);
} catch (Exception e) {
    log.error("Failed to send notification", e);
    // Code tiếp tục như bình thường — notification thất bại nhưng booking vẫn success?
}

// ❌ Nuốt lỗi trong stream
appointments.forEach(appointment -> {
    try {
        processAppointment(appointment);
    } catch (Exception e) {
        // Bỏ qua cái này, xử lý cái tiếp theo
    }
});
```

Ba pattern này đều phổ biến và đều nguy hiểm theo cách khác nhau.

## Tại sao nuốt lỗi nguy hiểm

Khi mày nuốt exception, hệ thống mất đi tín hiệu quan trọng nhất để biết có gì đó đang sai. Log không có gì. Monitoring không alert. Bệnh nhân không nhận được confirmation. Insurance không được verify. Tất cả xảy ra trong im lặng.

Điều tồi tệ hơn: trong nhiều trường hợp, mày không chỉ bỏ qua lỗi — mày đang để hệ thống tiếp tục trong trạng thái không nhất quán. `insuranceService.verify()` fail nhưng appointment vẫn được tạo ra và đánh dấu là verified. Bây giờ data trong database nói dối.

Và khi bug này được phát hiện — thường là bởi người dùng, không phải monitoring — mày không có log nào để trace back.

## Phân biệt: lỗi nào nên handle, lỗi nào nên propagate

Đây là câu hỏi cốt lõi: không phải mọi exception đều cần propagate lên. Nhưng mày phải có lý do rõ ràng khi quyết định không làm vậy.

**Lỗi nên propagate:** bất kỳ thứ gì ảnh hưởng đến tính đúng đắn của data hay business process.

```java
// ✅ Propagate — insurance verification fail là business critical
public void createAppointment(AppointmentRequest request) {
    // Nếu verify fail, exception bubble up, appointment không được tạo
    // User thấy lỗi rõ ràng, data không bị inconsistent
    insuranceService.verify(request.getPatientId());
    Appointment appointment = buildAppointment(request);
    appointmentRepository.save(appointment);
}
```

**Lỗi có thể handle riêng:** side effect không critical, có thể retry hoặc compensate sau.

```java
// ✅ Handle đúng cách — notification fail không nên block booking
public void createAppointment(AppointmentRequest request) {
    insuranceService.verify(request.getPatientId());
    Appointment appointment = buildAppointment(request);
    appointmentRepository.save(appointment);

    // Publish event — notification handler có retry logic riêng
    // Fail ở đây không rollback transaction booking
    try {
        eventPublisher.publishEvent(new AppointmentCreatedEvent(appointment));
    } catch (Exception e) {
        // Log đầy đủ, nhưng không re-throw
        // Retry sẽ được handle bởi event system
        log.warn("Failed to publish AppointmentCreatedEvent for appointmentId={}, " +
                 "notification will be retried by scheduler", appointment.getId(), e);
    }
}
```

Sự khác biệt: `insuranceService.verify()` fail thì appointment không nên tồn tại — propagate. `notificationService` fail thì appointment vẫn valid, notification có thể retry sau — handle riêng nhưng log đầy đủ.

## Custom exception hierarchy

Một trong những cách clean nhất để handle lỗi là define exception hierarchy cho domain của mày.

```java
// Base exception cho HMS
public abstract class HmsException extends RuntimeException {
    private final String errorCode;

    protected HmsException(String errorCode, String message) {
        super(message);
        this.errorCode = errorCode;
    }

    protected HmsException(String errorCode, String message, Throwable cause) {
        super(message, cause);
        this.errorCode = errorCode;
    }

    public String getErrorCode() { return errorCode; }
}

// Business exceptions
public class AppointmentNotFoundException extends HmsException {
    public AppointmentNotFoundException(Long id) {
        super("APPOINTMENT_NOT_FOUND", "Appointment not found: " + id);
    }
}

public class SlotAlreadyBookedException extends HmsException {
    public SlotAlreadyBookedException(Long doctorId, LocalDate date, String timeSlot) {
        super("SLOT_ALREADY_BOOKED",
            String.format("Slot already booked: doctor=%d, date=%s, time=%s",
                doctorId, date, timeSlot));
    }
}

public class InsuranceVerificationFailedException extends HmsException {
    public InsuranceVerificationFailedException(Long patientId, Throwable cause) {
        super("INSURANCE_VERIFICATION_FAILED",
            "Insurance verification failed for patient: " + patientId, cause);
    }
}
```

Với hierarchy này, global exception handler có thể route về đúng HTTP response code mà không cần catch từng loại ở mọi service.

```java
@RestControllerAdvice
public class GlobalExceptionHandler {

    @ExceptionHandler(AppointmentNotFoundException.class)
    public ResponseEntity<ErrorResponse> handleNotFound(AppointmentNotFoundException ex) {
        return ResponseEntity.status(HttpStatus.NOT_FOUND)
            .body(new ErrorResponse(ex.getErrorCode(), ex.getMessage()));
    }

    @ExceptionHandler(SlotAlreadyBookedException.class)
    public ResponseEntity<ErrorResponse> handleConflict(SlotAlreadyBookedException ex) {
        return ResponseEntity.status(HttpStatus.CONFLICT)
            .body(new ErrorResponse(ex.getErrorCode(), ex.getMessage()));
    }

    // Catch-all cho unexpected exceptions — không leak internal details
    @ExceptionHandler(Exception.class)
    public ResponseEntity<ErrorResponse> handleUnexpected(Exception ex) {
        log.error("Unexpected error", ex);
        return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR)
            .body(new ErrorResponse("INTERNAL_ERROR", "An unexpected error occurred"));
    }
}
```

## Log đúng khi handle exception

Khi mày quyết định handle exception thay vì propagate, log phải đủ để reconstruct tình huống sau này.

```java
// ❌ Log không đủ thông tin
log.error("Error processing appointment");

// ✅ Log đủ context để debug
log.error("Failed to process appointment: appointmentId={}, patientId={}, doctorId={}",
    appointment.getId(),
    appointment.getPatientId(),
    appointment.getDoctorId(),
    exception); // Pass exception cuối cùng để có stack trace
```

Rule: log phải trả lời được ba câu hỏi — *cái gì xảy ra*, *ở đâu*, và *với dữ liệu gì*.

## Takeaway

Tìm trong HMS của mày tất cả các `catch` block. Với mỗi cái, hỏi: "Nếu exception này xảy ra lúc 2 giờ sáng và tao đang ngủ, tao có biết không? Và tao có đủ thông tin để debug sáng hôm sau không?" Nếu câu trả lời là không — đó là bug đang chờ ngày ra đời.

---

*Bài tiếp theo: Code không test được thì chưa bao giờ là Clean Code*
