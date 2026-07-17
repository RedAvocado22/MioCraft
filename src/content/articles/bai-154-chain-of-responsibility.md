---
title: "Chain of Responsibility — khi request phải đi qua nhiều handler"
description: "GoF gặp bài toán: một request cần được xử lý bởi nhiều handler theo thứ tự, nhưng sender không nên biết handler nào sẽ thật sự xử lý nó. Bạn đang dùng pattern này mỗi khi gửi request qua Spring Security."
category: programming
pubDate: 2026-08-02
series: "Phần 5: Design Patterns"
tags: ["chain-of-responsibility", "design-pattern", "spring-security", "filter"]
---

Trước khi một HTTP request đến `AppointmentController`, nó đi qua:

1. Rate limit check — request này có bị throttle không?
2. JWT validation — token có hợp lệ không?
3. Authorization — user có quyền vào endpoint này không?
4. Request logging — log để audit trail
5. Sau đó mới đến business logic

Nếu step 2 fail, step 3, 4, 5 không chạy. Nếu step 3 fail, step 4, 5 không chạy. Mỗi step độc lập, theo thứ tự, có thể dừng chuỗi lại.

Đây là Chain of Responsibility — và bạn đã dùng nó mỗi ngày qua Spring Security filter chain mà có thể chưa biết tên.

---

## GoF giải bài gì

Không phải lúc nào bạn cũng biết trước ai sẽ xử lý một request. Hoặc bạn biết thứ tự, nhưng không muốn sender phải biết toàn bộ chuỗi — sender chỉ cần gửi request vào đầu chuỗi, từng handler tự quyết định "mình xử lý và dừng ở đây" hay "mình pass tiếp xuống".

GoF: **Chain of Responsibility tránh coupling sender với receiver bằng cách cho nhiều object cơ hội xử lý request. Các receiver được chain thành một chuỗi và request được pass dọc theo chuỗi cho đến khi một object xử lý nó.**

---

## Viết tay Chain of Responsibility trong HMS

HMS có validation pipeline cho booking request: bạn cần validate format, check slot availability, verify insurance, rồi mới tạo booking. Mỗi bước có thể reject với lý do khác nhau.

```java
// Handler interface
public interface BookingValidator {
    ValidationResult validate(CreateAppointmentRequest request);
}

// Handler 1: format validation
@Component
@Order(1)
public class RequestFormatValidator implements BookingValidator {
    @Override
    public ValidationResult validate(CreateAppointmentRequest request) {
        if (request.scheduledAt() == null) {
            return ValidationResult.rejected("scheduledAt is required");
        }
        if (request.scheduledAt().isBefore(LocalDateTime.now())) {
            return ValidationResult.rejected("Cannot book past appointment");
        }
        return ValidationResult.passed();
    }
}

// Handler 2: slot availability
@Component
@Order(2)
@RequiredArgsConstructor
public class SlotAvailabilityValidator implements BookingValidator {
    private final ScheduleRepository scheduleRepository;

    @Override
    public ValidationResult validate(CreateAppointmentRequest request) {
        boolean available = scheduleRepository
            .findById(request.scheduleId())
            .map(DoctorSchedule::hasAvailableSlots)
            .orElse(false);

        return available
            ? ValidationResult.passed()
            : ValidationResult.rejected("Slot is not available");
    }
}

// Handler 3: insurance verification
@Component
@Order(3)
@RequiredArgsConstructor
public class InsuranceValidator implements BookingValidator {
    private final InsuranceService insuranceService;

    @Override
    public ValidationResult validate(CreateAppointmentRequest request) {
        if (request.insuranceClaimId() == null) {
            return ValidationResult.passed(); // optional field
        }
        boolean valid = insuranceService.verify(request.insuranceClaimId(), request.patientId());
        return valid
            ? ValidationResult.passed()
            : ValidationResult.rejected("Insurance claim is not valid for this patient");
    }
}
```

Chain runner — inject tất cả handler theo `@Order`:

```java
@Component
@RequiredArgsConstructor
public class BookingValidationChain {

    private final List<BookingValidator> validators; // Spring inject theo @Order

    public ValidationResult validate(CreateAppointmentRequest request) {
        for (BookingValidator validator : validators) {
            ValidationResult result = validator.validate(request);
            if (!result.isPassed()) {
                return result; // dừng chuỗi, trả về lý do reject
            }
        }
        return ValidationResult.passed();
    }
}
```

`AppointmentService` chỉ gọi chain:

```java
ValidationResult validation = bookingValidationChain.validate(request);
if (!validation.isPassed()) {
    throw new ValidationException(validation.getReason());
}
```

Thêm validator mới? Tạo class, thêm `@Order`, Spring tự đưa vào chain. Không sửa gì khác.

---

## Chain of Responsibility trong Spring ecosystem

Bạn đã dùng pattern này mà không biết ở nhiều chỗ:

**Spring Security FilterChain:** mỗi filter là một handler — `CorsFilter`, `JwtAuthenticationFilter`, `AuthorizationFilter`... Request đi qua lần lượt, handler nào muốn dừng thì dừng bằng cách không gọi `filterChain.doFilter()`.

**Spring MVC HandlerInterceptor:** `preHandle` trả về `false` là dừng chuỗi.

**Servlet Filter:** `javax.servlet.Filter` với `FilterChain.doFilter()` là Chain of Responsibility trực tiếp.

Khi bạn implement `OncePerRequestFilter` trong Spring Boot (bài 108), bạn đang thêm một handler vào chain có sẵn của Spring Security.

---

## Khác biệt với Composite

Dễ lẫn với Composite (bài 153) vì cả hai đều xử lý nhiều object theo thứ tự. Khác nhau quan trọng:

**Composite**: tất cả node đều được xử lý, kết quả được tổng hợp (OR/AND/SUM...). Không có khái niệm "dừng sớm" vì fail.

**Chain of Responsibility**: chỉ một handler xử lý, hoặc handler nào cũng xử lý theo thứ tự nhưng **có thể dừng chuỗi**. Mục đích là decouple sender khỏi receiver, không phải aggregate kết quả.

Trong permission system của bài trước, Composite phù hợp vì tất cả rule đều phải được evaluate. Trong validation pipeline này, Chain of Responsibility phù hợp hơn vì fail sớm là behavior mong muốn.

---

## Khi nào không dùng Chain of Responsibility

Khi thứ tự không quan trọng và không cần "fail fast" — dùng danh sách xử lý song song hoặc simple loop đơn giản hơn.

Khi chuỗi quá dài và mỗi bước đều cần kết quả của bước trước — Pipeline pattern (biến thể của Chain) phù hợp hơn, và `Stream` của Java thực ra là pipeline.

Khi bạn muốn *tất cả* handler đều xử lý dù có fail giữa chừng — hãy dùng list và collect tất cả error thay vì dừng sớm.

---

## Takeaway

Chain of Responsibility tỏa sáng khi bạn có nhiều bước validation hoặc processing cần chạy theo thứ tự, mỗi bước có thể dừng chuỗi lại, và bạn muốn thêm/bớt bước mà không sửa orchestration code. Nếu bạn đang viết `if/else` lồng nhau với nhiều tầng validation trong một method, đó là signal để tách thành chain.

---

*Bài tiếp theo: Iterator — duyệt collection mà không cần biết bên trong có gì*
