---
title: "Proxy — không phải object nào cũng nên được truy cập trực tiếp"
description: "Proxy kiểm soát access đến object thật. Logging, caching, security check, lazy loading — tất cả đều có thể implement qua Proxy mà không sửa code gốc."
category: programming
pubDate: 2024-02-15
series: "Phần 5: Design Patterns"
tags: ["design-patterns", "proxy", "AOP"]
---

Đọc bài trước xong bạn có thể nghĩ: *"Decorator và Proxy trông giống nhau quá — đều là wrapper, đều implement cùng interface, đều delegate sang object gốc."*

Bạn đúng về cấu trúc. Nhưng sai về ý định — và trong design pattern, ý định là tất cả.

---

## Decorator vs Proxy: một câu

**Decorator** thêm behavior vào object.
**Proxy** kiểm soát quyền truy cập vào object.

Decorator nói: *"Trước/sau khi bạn làm việc này, mình sẽ làm thêm X."*
Proxy nói: *"Bạn có được phép làm việc này không? Có thật sự cần làm không? Mình sẽ quyết định."*

---

## Ba loại Proxy phổ biến trong production

**Protection Proxy** — kiểm soát quyền truy cập dựa trên permission.

Trong HMS, không phải doctor nào cũng được đọc mọi medical record. Doctor chỉ được xem record của bệnh nhân đang trong care của mình. Thay vì nhét authorization logic vào trong `MedicalRecordServiceImpl`, một Protection Proxy tách logic đó ra ngoài:

```java
public class ProtectedMedicalRecordService implements MedicalRecordService {
    
    private final MedicalRecordService delegate;
    private final AccessControlService accessControl;
    private final UserContext userContext;
    
    @Override
    public MedicalRecord getRecord(UUID recordId) {
        // Kiểm tra trước khi cho access
        if (!accessControl.canAccessRecord(userContext.getCurrentUserId(), recordId)) {
            throw new AccessDeniedException("You do not have access to this medical record");
        }
        return delegate.getRecord(recordId);
    }
    
    @Override
    public MedicalRecord updateRecord(UUID recordId, UpdateRecordRequest request) {
        if (!accessControl.canModifyRecord(userContext.getCurrentUserId(), recordId)) {
            throw new AccessDeniedException("You do not have permission to modify this record");
        }
        return delegate.updateRecord(recordId, request);
    }
}
```

Trong thực tế Spring, `@PreAuthorize` chính là cách Spring Security implement Protection Proxy — nó tạo một proxy wrap method của bạn, kiểm tra permission trước khi cho phép call vào.

**Virtual Proxy** — lazy loading, chỉ tạo object thật khi thực sự cần.

Ít liên quan đến Spring Service hơn, nhưng xuất hiện thường xuyên với JPA. Khi bạn load một `Appointment` với `fetch = LAZY` trên relationship `MedicalRecord`, JPA không load `MedicalRecord` ngay. Nó tạo một Proxy object ở chỗ đó — chỉ khi code thực sự access field của `MedicalRecord` thì query mới thực sự chạy.

Đây là lý do lazy loading ném `LazyInitializationException` khi bạn access nó ngoài transaction — proxy không thể thực hiện query vì connection đã đóng.

**Caching Proxy** — trả về cached result thay vì gọi object thật.

```java
public class CachedDoctorScheduleService implements DoctorScheduleService {
    
    private final DoctorScheduleService delegate;
    private final RedisTemplate<String, List<DoctorScheduleResponse>> redisTemplate;
    
    @Override
    public List<DoctorScheduleResponse> getAvailableSchedules(UUID doctorId, LocalDate date) {
        String cacheKey = "schedule:" + doctorId + ":" + date;
        
        // Kiểm tra cache trước
        List<DoctorScheduleResponse> cached = redisTemplate.opsForValue().get(cacheKey);
        if (cached != null) {
            return cached; // Không gọi delegate — trả thẳng từ cache
        }
        
        // Cache miss — gọi object thật, rồi lưu vào cache
        List<DoctorScheduleResponse> result = delegate.getAvailableSchedules(doctorId, date);
        redisTemplate.opsForValue().set(cacheKey, result, Duration.ofMinutes(5));
        return result;
    }
}
```

`@Cacheable` của Spring là cách framework implement đúng cái này — bạn không cần tự viết boilerplate nữa.

---

## Proxy trong Spring là mặc định, không phải exception

Điều mà nhiều developer không nhận ra: **Spring dùng Proxy ở khắp nơi**. Mỗi bean Spring manage là một proxy, không phải object thật.

Khi bạn inject `AppointmentService` vào một class khác, bạn không nhận được `AppointmentServiceImpl` trực tiếp — bạn nhận được một proxy do Spring tạo ra. Proxy đó là thứ xử lý `@Transactional`, `@Cacheable`, `@PreAuthorize` trước khi delegate vào method thật.

Đây là lý do `@Transactional` không hoạt động khi một method trong cùng class gọi method khác trong cùng class đó:

```java
@Service
public class AppointmentService {
    
    public void processAppointment(UUID id) {
        // ❌ Vấn đề: gọi nội bộ, không đi qua proxy
        // @Transactional trên confirmAppointment sẽ KHÔNG có hiệu lực
        this.confirmAppointment(id);
    }
    
    @Transactional
    public void confirmAppointment(UUID id) {
        // Transaction được tạo bởi proxy — nhưng khi gọi từ this, bypass proxy hoàn toàn
    }
}
```

Khi `processAppointment` gọi `this.confirmAppointment`, nó gọi trực tiếp vào object thật, bỏ qua proxy. Proxy không có cơ hội intercept. Transaction không được tạo.

Hiểu Proxy không chỉ là hiểu một design pattern — nó là hiểu tại sao Spring hoạt động theo cách nó hoạt động.

---

## Takeaway

Lần tới khi `@Transactional` không hoạt động như bạn nghĩ — trước khi Google stack trace, hỏi: *"Method này có đang được gọi từ trong cùng class không?"* Nếu có, bạn vừa gặp self-invocation problem — Spring Proxy 101.

---

*Bài tiếp theo: Command Pattern — khi hành vi cần được điều phối*
