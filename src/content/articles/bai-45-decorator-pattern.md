---
title: "Decorator — kế thừa không sai, sai là bạn dùng nó để mở rộng hành vi"
description: "Kế thừa mở rộng là static và compile-time. Decorator mở rộng là dynamic và runtime. Khi behavior cần thay đổi linh hoạt — Decorator là lựa chọn đúng."
category: programming
pubDate: 2024-02-14
series: "Phần 5: Design Patterns"
tags: ["design-patterns", "decorator", "OOP"]
---

Giả sử HMS cần audit log: mỗi lần một doctor cập nhật medical record, hệ thống phải ghi lại ai làm gì, lúc mấy giờ, dữ liệu cũ là gì. Ban đầu, cách đơn giản nhất là thêm logic vào trong `MedicalRecordService`:

```java
public void updateRecord(UUID recordId, UpdateRecordRequest request) {
    MedicalRecord record = recordRepository.findById(recordId).orElseThrow();
    MedicalRecord oldRecord = record.copy(); // Snapshot trước khi sửa
    
    record.update(request);
    recordRepository.save(record);
    
    // Audit log — nhét vào đây cho tiện
    auditLogRepository.save(AuditLog.of("UPDATE_RECORD", oldRecord, record, userContext.getCurrentUser()));
}
```

Chạy được. Nhưng bây giờ `MedicalRecordService` đang làm hai việc: business logic và audit. Khi team quyết định thêm audit vào tất cả các service khác — `AppointmentService`, `PrescriptionService`, `PatientService` — bạn sẽ copy đoạn code đó vào mười mấy chỗ. Khi format audit log thay đổi, bạn phải tìm và sửa từng nơi một.

Một developer khác trong team sẽ nghĩ: *"Dùng kế thừa thôi, tạo một `AuditedMedicalRecordService extends MedicalRecordService`."* Nghe hợp lý. Nhưng đây là nơi nhiều người đi sai đường.

---

## Tại sao kế thừa không phải câu trả lời cho bài toán này

Kế thừa mô hình hóa quan hệ **is-a**: `Doctor is an Employee`, `AppointmentConfirmedSender is a NotificationSender`. Nó phù hợp khi class con là một phiên bản chuyên biệt hơn của class cha.

Nhưng `AuditedMedicalRecordService` không phải là một loại `MedicalRecordService` — nó là `MedicalRecordService` cộng thêm một hành vi. Đây là quan hệ **has-a-behavior**. Dùng kế thừa ở đây tạo ra một vấn đề cụ thể: bạn bị lock vào compile time. Không thể bật/tắt audit theo runtime config. Không thể add thêm behavior khác (caching, validation) mà không tạo thêm class kế thừa mới. Class hierarchy bắt đầu phình ra: `AuditedCachedMedicalRecordService extends AuditedMedicalRecordService`... và nó chỉ tệ hơn theo thời gian.

---

## Decorator: wrap behavior, không kế thừa

Decorator hoạt động bằng cách wrap một object trong một object khác có cùng interface. Wrapper thêm behavior trước/sau khi delegate sang object gốc.

```java
public interface MedicalRecordService {
    MedicalRecord updateRecord(UUID recordId, UpdateRecordRequest request);
    MedicalRecord getRecord(UUID recordId);
    // ...
}

// Implementation gốc — chỉ làm business logic
@Service
@Primary
public class MedicalRecordServiceImpl implements MedicalRecordService {
    
    @Override
    public MedicalRecord updateRecord(UUID recordId, UpdateRecordRequest request) {
        MedicalRecord record = recordRepository.findById(recordId).orElseThrow();
        record.update(request);
        return recordRepository.save(record);
    }
}

// Decorator thêm audit — wrap implementation gốc
public class AuditedMedicalRecordService implements MedicalRecordService {
    
    private final MedicalRecordService delegate; // Object gốc được wrap
    private final AuditLogRepository auditLogRepository;
    private final UserContext userContext;
    
    public AuditedMedicalRecordService(MedicalRecordService delegate, 
                                        AuditLogRepository auditLogRepository,
                                        UserContext userContext) {
        this.delegate = delegate;
    }
    
    @Override
    public MedicalRecord updateRecord(UUID recordId, UpdateRecordRequest request) {
        // Lấy snapshot trước khi delegate thực hiện
        MedicalRecord before = delegate.getRecord(recordId);
        
        // Delegate sang implementation gốc
        MedicalRecord after = delegate.updateRecord(recordId, request);
        
        // Thêm behavior: audit log SAU KHI delegate thực hiện
        auditLogRepository.save(AuditLog.builder()
            .action("UPDATE_MEDICAL_RECORD")
            .entityId(recordId)
            .before(objectMapper.writeValueAsString(before))
            .after(objectMapper.writeValueAsString(after))
            .performedBy(userContext.getCurrentUserId())
            .build());
        
        return after;
    }
    
    @Override
    public MedicalRecord getRecord(UUID recordId) {
        // Read không cần audit — delegate thẳng
        return delegate.getRecord(recordId);
    }
}
```

---

## Trong Spring: @Aspect làm điều này tốt hơn

Thực tế, Spring AOP là cách Decorator pattern được implement phổ biến nhất trong Spring codebase. `@Transactional`, `@Cacheable`, `@PreAuthorize` — tất cả đều là Decorator hoạt động thông qua proxy.

Bạn có thể viết custom Aspect cho audit:

```java
@Aspect
@Component
public class AuditAspect {
    
    // Intercept tất cả method có annotation @Audited
    @Around("@annotation(audited)")
    public Object auditMethod(ProceedingJoinPoint joinPoint, Audited audited) throws Throwable {
        Object result = joinPoint.proceed(); // Delegate sang method gốc
        
        auditLogRepository.save(AuditLog.builder()
            .action(audited.action())
            .performedBy(userContext.getCurrentUserId())
            .build());
        
        return result;
    }
}

// Dùng:
@Audited(action = "UPDATE_MEDICAL_RECORD")
public MedicalRecord updateRecord(UUID recordId, UpdateRecordRequest request) {
    // Chỉ business logic, không có audit code
}
```

Đây là Decorator pattern ở tầng framework — Spring tự tạo proxy wrap method của bạn, thêm behavior trước/sau mà không cần bạn viết boilerplate wrapper class.

---

## Khi nào dùng Decorator, khi nào dùng kế thừa

Dùng **kế thừa** khi class con là một phiên bản chuyên biệt hơn: `EmergencyAppointment extends Appointment`, class con override behavior vì nó có rules khác.

Dùng **Decorator** khi bạn muốn thêm behavior vào một object mà không thay đổi class đó: logging, caching, validation, audit, retry logic. Behavior này độc lập với business logic và có thể được bật/tắt, kết hợp tùy ý.

---

## Takeaway

Mỗi lần bạn định viết code kiểu `// Thêm X vào trước/sau khi làm Y` trong một method — đó là Decorator đang gõ cửa. Câu hỏi: behavior đó có phải là một phần của business logic không? Nếu không — nó nên là một lớp bọc bên ngoài, không phải code nằm lẫn bên trong.

---

*Bài tiếp theo: Proxy — không phải object nào cũng nên được truy cập trực tiếp*
