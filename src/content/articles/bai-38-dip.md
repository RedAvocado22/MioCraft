---
title: "DIP — business code mà phụ thuộc DB thì sớm muộn cũng khổ"
description: "Dependency Inversion: code cấp cao không phụ thuộc code cấp thấp. Cả hai phụ thuộc abstraction. Đây là nền tảng của Dependency Injection trong mọi framework."
category: programming
pubDate: 2024-02-07
series: "Phần 4: SOLID"
tags: ["SOLID", "DIP", "dependency-injection"]
---

Hãy tưởng tượng mày xây một cái nhà. Mày chọn thợ điện giỏi nhất — nhưng thay vì dùng ổ cắm chuẩn, thợ điện đó hàn thẳng dây điện vào từng thiết bị trong nhà. Tivi hàn vào tường. Tủ lạnh hàn vào tường. Laptop hàn vào tường.

Một ngày nào đó mày muốn thay tivi mới. Mày phải đập tường.

Đây chính xác là điều xảy ra khi business logic của mày phụ thuộc trực tiếp vào infrastructure — database, Redis, email service, Keycloak. Không phải ngay lập tức. Nhưng khi thứ đó cần thay đổi, mày sẽ phải đập tường.

---

## Dependency Inversion Principle là gì

DIP có hai điểm:

1. High-level modules should not depend on low-level modules. Both should depend on abstractions.
2. Abstractions should not depend on details. Details should depend on abstractions.

"High-level module" là business logic — logic nói về appointment, patient, payment. Thứ mà domain expert hiểu và care về.

"Low-level module" là infrastructure — JPA repository, Redis, email sender, HTTP client. Thứ mà infrastructure engineer quan tâm.

DIP nói: business logic không được biết infrastructure đang là gì. Nó chỉ được biết *interface* — contract của những gì nó cần.

---

## Ví dụ — dependency chảy sai chiều

HMS có `AppointmentService` cần gửi notification sau khi booking thành công:

```java
// ❌ Vấn đề — business logic đang phụ thuộc trực tiếp vào infrastructure
@Service
public class AppointmentService {

    // Phụ thuộc trực tiếp vào JavaMailSender — infrastructure của Spring
    @Autowired
    private JavaMailSender mailSender;

    // Phụ thuộc trực tiếp vào RedisTemplate — infrastructure của Redis
    @Autowired
    private RedisTemplate<String, Object> redisTemplate;

    // Phụ thuộc trực tiếp vào repository — JPA infrastructure
    @Autowired
    private AppointmentRepository appointmentRepository;

    public AppointmentResponse book(BookAppointmentRequest request) {
        // booking logic...
        
        // Gửi email trực tiếp — biết về MimeMessage, transport protocol
        MimeMessage message = mailSender.createMimeMessage();
        MimeMessageHelper helper = new MimeMessageHelper(message);
        helper.setTo(patient.getEmail());
        helper.setSubject("Booking confirmed");
        helper.setText("Your appointment on " + appointment.getDate() + " is confirmed.");
        mailSender.send(message);
        
        // Invalidate cache trực tiếp — biết về Redis key structure
        redisTemplate.delete("doctor:schedule:" + request.getDoctorId());
        
        return mapper.toResponse(appointment);
    }
}
```

Có mấy vấn đề ở đây:

**Vấn đề 1 — Không thể test business logic một mình.** Muốn unit test `book()`, mày phải setup JavaMailSender mock (tức là phải import Spring Mail vào test), RedisTemplate mock, tất cả. Để test business rule "đặt lịch thành công thì status là PENDING" — mày phải chuẩn bị infrastructure của email lẫn Redis.

**Vấn đề 2 — Thay đổi infrastructure kéo theo thay đổi business logic.** Team quyết định chuyển từ email sang Kafka event để gửi notification? Mày phải mở `AppointmentService` ra sửa. Business logic không thay đổi, nhưng mày vẫn phải sửa nó vì infrastructure thay đổi.

**Vấn đề 3 — Business code biết quá nhiều về infrastructure detail.** `MimeMessage`, `MimeMessageHelper`, Redis key structure — những thứ này không thuộc về business logic. Chúng là chi tiết kỹ thuật.

---

## Đảo ngược dependency

Giải pháp là tạo abstraction giữa business logic và infrastructure. Business logic phụ thuộc vào abstraction — infrastructure implement abstraction đó:

```java
// ✅ Tốt hơn — business logic chỉ biết về interface

// Abstraction — business logic chỉ cần biết điều này
public interface AppointmentNotifier {
    void notifyBookingConfirmed(Appointment appointment);
}

// Abstraction — business logic chỉ cần biết điều này
public interface SlotCacheInvalidator {
    void invalidateSlots(UUID doctorId, LocalDate date);
}

// Business logic — không biết gì về email hay Redis
@Service
public class AppointmentService {

    private final AppointmentRepository appointmentRepository;
    private final AppointmentNotifier notifier;          // abstraction
    private final SlotCacheInvalidator cacheInvalidator; // abstraction

    public AppointmentResponse book(BookAppointmentRequest request) {
        // booking logic...
        appointmentRepository.save(appointment);

        // Không biết là email, SMS, hay Kafka — chỉ biết là "notify"
        notifier.notifyBookingConfirmed(appointment);
        
        // Không biết là Redis hay Caffeine hay gì — chỉ biết là "invalidate"
        cacheInvalidator.invalidateSlots(request.getDoctorId(), appointment.getDate());

        return mapper.toResponse(appointment);
    }
}

// Infrastructure detail — biết về JavaMailSender
@Component
public class EmailAppointmentNotifier implements AppointmentNotifier {

    private final JavaMailSender mailSender;

    @Override
    public void notifyBookingConfirmed(Appointment appointment) {
        MimeMessage message = mailSender.createMimeMessage();
        // setup email...
        mailSender.send(message);
    }
}

// Infrastructure detail — biết về Redis
@Component
public class RedisSlotCacheInvalidator implements SlotCacheInvalidator {

    private final RedisTemplate<String, Object> redisTemplate;

    @Override
    public void invalidateSlots(UUID doctorId, LocalDate date) {
        redisTemplate.delete("doctor:schedule:" + doctorId + ":" + date);
    }
}
```

Bây giờ:

- Unit test `AppointmentService` chỉ cần mock `AppointmentNotifier` với một anonymous class đơn giản — không cần JavaMailSender, không cần Redis
- Chuyển từ email sang Kafka: tạo `KafkaAppointmentNotifier implements AppointmentNotifier`, swap bean trong Spring config — business logic không đụng đến
- Business code đọc như business language: "notify booking confirmed", "invalidate slots" — không phải `MimeMessageHelper` hay Redis key string

---

## DIP trong Spring Boot — dependency injection là DIP in action

Đây là điều quan trọng cần hiểu: **Spring's dependency injection là một cơ chế để thực hiện DIP.**

Khi mày dùng constructor injection với interface:

```java
@Service
public class AppointmentService {
    
    private final AppointmentNotifier notifier;
    
    // Spring inject implementation, nhưng AppointmentService chỉ biết interface
    public AppointmentService(AppointmentNotifier notifier) {
        this.notifier = notifier;
    }
}
```

Spring quyết định inject `EmailAppointmentNotifier` hay `KafkaAppointmentNotifier` — `AppointmentService` không biết và không cần biết. Dependency được inject từ bên ngoài vào, không phải được tạo ra bên trong. Đó chính là "inversion of control" — thứ mà Spring được xây dựng xung quanh.

Mày đã dùng DIP từ ngày đầu code Spring Boot, chỉ là chưa có tên cho nó.

---

## Repository pattern là DIP áp dụng cho database

Lý do tại sao Spring Data JPA tồn tại — và tại sao mày không gọi `entityManager.createQuery()` thẳng trong service — cũng là DIP.

```java
// AppointmentService không biết database là MySQL hay PostgreSQL
// Không biết ORM là JPA hay MyBatis
// Chỉ biết interface contract
public interface AppointmentRepository extends JpaRepository<Appointment, UUID> {
    List<Appointment> findByDoctorIdAndDate(UUID doctorId, LocalDate date);
}
```

Nếu ngày mai team quyết định move một phần sang MongoDB — mày chỉ cần tạo `MongoAppointmentRepository implements AppointmentRepository`. `AppointmentService` không cần biết.

---

## Takeaway

Mỗi lần mày thấy business logic đang import class từ `org.springframework.mail`, `org.springframework.data.redis`, hay `javax.persistence` — hỏi: *"Logic này có cần biết về infrastructure detail không, hay nó chỉ cần biết kết quả?"* Nếu chỉ cần kết quả — tạo abstraction. Đặt interface ở giữa. Business logic phụ thuộc vào interface, infrastructure implement interface. Dependency chảy từ detail lên abstraction — không phải ngược lại.

---

*Bài tiếp theo: SOLID không làm code tốt hơn nếu mày dùng nó sai thời điểm*
