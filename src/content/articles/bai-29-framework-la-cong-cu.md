---
title: "Framework là công cụ, không phải nền móng"
description: "Khi toàn bộ business logic phụ thuộc vào Spring Boot — bạn không có kiến trúc, bạn có một Spring Boot app. Và khi Spring thay đổi, mọi thứ thay đổi."
category: architecture
pubDate: 2024-01-29
series: "Phần 3: Kiến trúc phần mềm"
tags: ["architecture", "framework", "clean-architecture"]
---

Có một thứ mà hầu hết developer học Spring Boot không nhận ra cho đến khi đã quá muộn: **Spring Boot không phải là hệ thống của mày — nó là công cụ mày dùng để xây hệ thống.**

Nghe có vẻ hiển nhiên. Nhưng nếu business logic của mày không thể chạy mà không có Spring context, nếu domain object của mày import từ `org.springframework.*`, nếu mày không thể test một rule nghiệp vụ mà không boot application — thì mày đang xây hệ thống *bên trong* Spring thay vì dùng Spring như một tool.

---

## Framework coupling trông như thế nào

Khi Spring Boot trở thành nền móng thay vì công cụ, nó thấm vào mọi tầng:

```java
// ❌ Domain object biết về Spring Security
public class Appointment {

    public void cancel() {
        // Business rule phụ thuộc vào Spring Security context
        Authentication auth = SecurityContextHolder.getContext().getAuthentication();
        String role = auth.getAuthorities().iterator().next().getAuthority();
        if (!role.equals("ROLE_PATIENT") && !role.equals("ROLE_DOCTOR")) {
            throw new AccessDeniedException("No permission to cancel");
        }
        this.status = CANCELLED;
    }
}
```

```java
// ❌ Domain object dùng Spring's @Value
public class DoctorSchedule {

    @Value("${schedule.max-booking-advance-days:30}")
    private int maxAdvanceDays; // Spring inject vào domain object

    public void validateBookingDate(LocalDate date) {
        if (date.isAfter(LocalDate.now().plusDays(maxAdvanceDays))) {
            throw new InvalidBookingDateException("...");
        }
    }
}
```

```java
// ❌ Business logic phụ thuộc vào @Transactional annotation
// Nếu không có Spring, method này không có behavior transaction nào
@Service
public class AppointmentService {
    
    @Transactional  // annotation trên method là hợp lý — nhưng...
    public void bookAppointment(BookingRequest request) {
        // ...logic phụ thuộc vào việc annotation này được honor
        // Nếu gọi method này từ cùng class, Spring proxy bị bypass
        this.validateInsurance(request); // ← internal call, @Transactional không propagate
    }
    
    @Transactional(propagation = Propagation.REQUIRES_NEW)
    private void validateInsurance(BookingRequest request) { ... }
}
```

Ba ví dụ trên là ba cách framework coupling xảy ra: security context trong domain, configuration injection vào domain, và behavior phụ thuộc vào proxy mechanism. Cả ba đều tạo ra domain logic không thể test và không thể hiểu nếu tách khỏi Spring.

---

## Tại sao điều này quan trọng hơn mày nghĩ

Hậu quả thực tế không phải là "code xấu" theo nghĩa trừu tượng. Nó ảnh hưởng trực tiếp đến tốc độ phát triển:

**Test speed**: Mỗi unit test phải boot Spring context mất từ hai đến năm giây. Với 200 test, đó là mười phút chỉ để start. CI pipeline mày mất cả tiếng chỉ để chạy test.

**Portability**: Khi team quyết định thêm một worker process không dùng Spring Web (chỉ dùng Spring Batch, hoặc native Java process) — business logic không thể reuse vì nó cần full Spring context.

**Reasoning**: Khi business rule có bug, mày phải trace xuyên qua Spring proxy, annotation processing, AOP weaving — thay vì chỉ đọc code Java thuần.

---

## Dùng Spring đúng chỗ

Tách framework ra khỏi domain không có nghĩa là không dùng framework. Nó có nghĩa là dùng đúng chỗ:

```java
// ✅ Domain object thuần túy — không biết Spring tồn tại
public class Appointment {

    // Authorization info được truyền vào thay vì lấy từ context
    public void cancel(CancelAppointmentCommand command) {
        if (!command.requesterId().equals(this.patientId) 
                && !command.requesterRole().canCancelAppointments()) {
            throw new UnauthorizedCancellationException("...");
        }
        if (this.status == COMPLETED) {
            throw new InvalidTransitionException("Cannot cancel completed appointment");
        }
        this.status = CANCELLED;
    }
}

// ✅ Spring ở đúng chỗ của nó — presentation/application layer
@Component
public class CancelAppointmentUseCase {

    public void execute(UUID appointmentId, UUID requesterId) {
        // Spring Security ở đây — presentation/application layer
        UserContext requester = userContextProvider.getCurrentUser(); // Spring-aware

        Appointment appointment = appointmentStore.getById(appointmentId);

        // Truyền authorization context vào domain — domain không tự lấy
        appointment.cancel(new CancelAppointmentCommand(requesterId, requester.getRole()));

        appointmentStore.save(appointment);
    }
}
```

Spring xử lý HTTP, DI, transaction, security, config — tất cả những thứ infrastructure. Domain nhận data đã được resolve, không tự đi lấy từ Spring context.

---

## Quy tắc ngón tay cái

Import nào từ `org.springframework.*` xuất hiện trong class nằm trong package `domain/` — đó là dấu hiệu cần xem lại. Không phải tuyệt đối sai trong mọi trường hợp, nhưng luôn là câu hỏi: *"Class này biết về Spring vì lý do gì?"*

---

## Takeaway

Spring Boot là một trong những framework tốt nhất để xây backend — nhưng nó được thiết kế để serve domain của mày, không phải để trở thành domain của mày. Nếu mày phải explain business logic của hệ thống và câu trả lời liên quan đến Spring annotations — đó là dấu hiệu rõ ràng cần refactor.

---

*Bài tiếp theo: Refactor kiến trúc không phải là viết lại — là chỉnh hướng dần dần*
