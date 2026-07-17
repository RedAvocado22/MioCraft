---
title: "Layered Architecture không phải lúc nào cũng đúng"
description: "Layered architecture giải quyết một vấn đề cụ thể. Khi bạn dùng nó cho bài toán khác — bạn đang tạo ra vấn đề thay vì giải quyết nó."
category: architecture
pubDate: 2024-01-22
series: "Phần 3: Kiến trúc phần mềm"
tags: ["architecture", "layered-architecture", "design"]
---

Có một điều mà hầu hết tutorial Spring Boot không nói với bạn: kiến trúc Controller/Service/Repository mà bạn đang dùng được thiết kế cho một loại ứng dụng cụ thể — và ứng dụng đó không nhất thiết là ứng dụng bạn đang xây.

Không phải Layered Architecture sai. Mà là nó được thiết kế để giải quyết một nhóm vấn đề, và như mọi công cụ khác, dùng nó cho vấn đề khác sẽ cho ra kết quả tệ.

---

## Layered Architecture giỏi cái gì

Ba layer — presentation, business, data — ra đời từ thời enterprise application những năm 90. Lúc đó, bài toán chủ yếu là: *một đống data trong DB, cần expose ra ngoài theo nhiều cách khác nhau*. CRUD nặng, business logic đơn giản, nhiều integration với các system khác.

Với bài toán đó, ba layer hoạt động tốt. Bạn tách được "cách lấy data" ra khỏi "cách hiển thị data." Repository lo việc SQL, Controller lo việc HTTP, Service nằm giữa làm trọng tài. Rõ ràng, dễ test, dễ thay thế từng layer.

Nếu HMS chỉ là một CRUD app — tạo bệnh nhân, tạo lịch hẹn, lấy danh sách, sửa, xóa — thì ba layer là đủ và là lựa chọn đúng.

---

## Khi nào nó bắt đầu rạn nứt

Vấn đề xuất hiện khi business logic trở nên thật sự phức tạp — không phải "phức tạp về kỹ thuật" mà "phức tạp về quy tắc nghiệp vụ."

Lấy ví dụ việc đặt lịch hẹn trong HMS:

```java
// Bài toán: đặt lịch hẹn cho bệnh nhân
// Nghe đơn giản — nhưng thực ra nó bao gồm:
// 1. Validate bệnh nhân có được đặt không (đã có appointment chưa confirmed không?)
// 2. Validate doctor schedule còn slot không
// 3. Check insurance coverage cho loại khám này
// 4. Atomic lock slot trong Redis để tránh double-booking
// 5. Tạo Appointment entity
// 6. Decrement available slots trong DoctorSchedule
// 7. Gửi notification cho patient và doctor
// 8. Log audit trail
```

Tám bước. Mỗi bước có logic riêng. Và tất cả cần xảy ra trong một flow nhất quán, với rollback rõ ràng nếu bất kỳ bước nào fail.

Trong Layered Architecture thuần túy, tất cả điều này đổ vào `AppointmentService.bookAppointment()`. Method đó sẽ inject `InsuranceService`, `RedisService`, `NotificationService`, `DoctorScheduleService`, và còn nữa. Nó biết về mọi thứ, phụ thuộc vào mọi thứ, và test nó đòi hỏi mock mọi thứ.

Đây không phải vấn đề của developer viết code tệ. Đây là kiến trúc không còn fit với bài toán.

---

## Điểm mù lớn nhất của ba layer: dependency đi sai hướng

Trong Layered Architecture, dependency đi từ trên xuống dưới:

```
Controller  →  Service  →  Repository  →  Database
```

Có vẻ hợp lý. Nhưng nhìn kỹ hơn: Service layer — nơi chứa business logic quan trọng nhất — đang **phụ thuộc trực tiếp vào** Repository, tức là đang phụ thuộc vào cách bạn lưu data.

Điều đó có nghĩa là: nếu bạn quyết định thay MySQL bằng PostgreSQL, hoặc thêm Redis cache trước DB, hoặc migrate một phần sang NoSQL — business logic của bạn bị ảnh hưởng. Không phải vì logic thay đổi, mà vì nó đang bị coupled với tầng infrastructure.

```java
// ❌ Vấn đề: AppointmentService biết về JPA specifics
@Service
public class AppointmentService {
    
    @Autowired
    private AppointmentRepository repository; // JPA Repository
    
    public AppointmentResponse bookAppointment(BookingRequest request) {
        // business logic mixed với JPA concepts
        Appointment appointment = new Appointment();
        appointment.setStatus(AppointmentStatus.PENDING);
        // ...
        return mapper.toResponse(repository.save(appointment)); // trực tiếp gọi JPA
    }
}

// ✅ Tốt hơn: business logic không biết JPA tồn tại
@Service
public class AppointmentService {
    
    @Autowired
    private AppointmentStore appointmentStore; // interface — không biết implementation
    
    public AppointmentResponse bookAppointment(BookingRequest request) {
        Appointment appointment = Appointment.create(request); // factory method trên domain
        appointmentStore.save(appointment); // contract, không phải implementation
        return AppointmentResponse.from(appointment);
    }
}
```

Cái khác biệt ở đây không phải là "dùng interface thay vì class" — đó chỉ là syntax. Cái khác biệt là **ai phụ thuộc vào ai**. Business logic không biết JPA là gì. Nó chỉ biết "mình cần lưu appointment vào đâu đó" — và delegate cho một contract.

---

## Vậy dùng cái gì thay thế?

Không có câu trả lời universal. Nhưng khi project đủ lớn và business logic đủ phức tạp, các kiến trúc như **Clean Architecture**, **Hexagonal Architecture (Ports & Adapters)**, hoặc **Domain-Driven Design** xuất hiện để giải quyết đúng những vấn đề mà Layered Architecture để lại.

Ý tưởng cốt lõi của những kiến trúc này, dù tên gọi khác nhau, đều xoay quanh một nguyên tắc: **domain logic là trái tim của hệ thống, và nó không được phụ thuộc vào bất kỳ thứ gì khác — kể cả framework, kể cả database.**

Phần còn lại của Phần 3 sẽ đi sâu vào từng khía cạnh của nguyên tắc này.

---

## Takeaway

Ba layer không sai — nó fit cho ứng dụng CRUD đơn giản. Khi business logic trở nên phức tạp và có nhiều quy tắc nghiệp vụ thật sự, hãy hỏi: *"Service của mình đang phụ thuộc vào cái gì, và nếu cái đó thay đổi, mình có bị kéo theo không?"* Câu trả lời sẽ cho bạn biết kiến trúc hiện tại có đang fit hay không.

---

*Bài tiếp theo: Business logic đặt sai chỗ — hệ thống sẽ trả giá*
