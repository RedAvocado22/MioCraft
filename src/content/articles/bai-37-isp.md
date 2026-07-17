---
title: "ISP — interface càng to, code càng yếu"
description: "Interface Segregation: đừng ép class implement những method nó không cần. Interface phình to là dấu hiệu của coupling ẩn và design thiếu suy nghĩ."
category: programming
pubDate: 2024-02-06
series: "Phần 4: SOLID"
tags: ["SOLID", "ISP", "interface"]
---

Tưởng tượng bạn vào làm việc ở một công ty, và sếp đưa cho bạn một bản mô tả công việc dài mười trang. Trong đó có: thiết kế database, viết code backend, deploy infrastructure, vẽ UI, viết marketing copy, handle customer support, và đôi khi nếu cần thì lái xe đi giao tài liệu.

Bạn sẽ sign không?

Trong code, đây là chính xác những gì xảy ra khi bạn tạo ra một interface quá to. Và đây là điều mà **Interface Segregation Principle** muốn giải quyết.

---

## Vấn đề với "fat interface"

HMS có một giai đoạn mà tất cả operations liên quan đến `DoctorSchedule` được gom vào một interface:

```java
// ❌ Vấn đề — interface đang làm quá nhiều việc
public interface DoctorScheduleService {
    
    // Operations cho doctor portal
    List<DoctorScheduleResponse> getMySchedules(UUID doctorId);
    DoctorScheduleResponse createSchedule(CreateScheduleRequest request);
    void updateSchedule(UUID scheduleId, UpdateScheduleRequest request);
    void deleteSchedule(UUID scheduleId);
    
    // Operations cho patient booking flow
    List<AvailableSlotResponse> getAvailableSlots(UUID doctorId, LocalDate date);
    boolean isSlotAvailable(UUID scheduleId, int slot);
    
    // Operations cho admin dashboard
    ScheduleStatisticsResponse getStatistics(LocalDate from, LocalDate to);
    List<DoctorScheduleResponse> getAllSchedules(Pageable pageable);
    void bulkUpdateStatus(List<UUID> scheduleIds, ScheduleStatus status);
    
    // Operations cho report export
    byte[] exportSchedulesToPdf(LocalDate from, LocalDate to);
    byte[] exportSchedulesToExcel(LocalDate from, LocalDate to);
}
```

Bây giờ bạn có một `AppointmentService` cần query slot khả dụng. Để làm điều đó, nó phải inject `DoctorScheduleService` — và theo mặc định, nó phải "biết về" tất cả methods khác trong interface đó: `bulkUpdateStatus`, `exportSchedulesToPdf`, tất cả. Dù nó chỉ dùng `getAvailableSlots` và `isSlotAvailable`.

Còn khi viết unit test cho `AppointmentService`? Bạn phải mock toàn bộ `DoctorScheduleService` — tám method bạn không care, cộng với hai method bạn cần. Nếu sau này team thêm method thứ chín vào interface, tất cả mock trong tất cả test đều phải update.

---

## Interface Segregation Principle

Nguyên tắc ISP nói: *"Clients should not be forced to depend on interfaces they do not use."*

Dịch ra: đừng bắt caller phụ thuộc vào contract chứa những thứ nó không cần. Tách interface nhỏ lại, theo từng nhóm caller có nhu cầu riêng.

```java
// ✅ Tốt hơn — tách theo nhu cầu của từng caller

// Doctor portal cần
public interface DoctorScheduleManagementService {
    List<DoctorScheduleResponse> getMySchedules(UUID doctorId);
    DoctorScheduleResponse createSchedule(CreateScheduleRequest request);
    void updateSchedule(UUID scheduleId, UpdateScheduleRequest request);
    void deleteSchedule(UUID scheduleId);
}

// Patient booking flow cần
public interface ScheduleAvailabilityService {
    List<AvailableSlotResponse> getAvailableSlots(UUID doctorId, LocalDate date);
    boolean isSlotAvailable(UUID scheduleId, int slot);
}

// Admin cần
public interface ScheduleAdminService {
    ScheduleStatisticsResponse getStatistics(LocalDate from, LocalDate to);
    List<DoctorScheduleResponse> getAllSchedules(Pageable pageable);
    void bulkUpdateStatus(List<UUID> scheduleIds, ScheduleStatus status);
}

// Report export cần
public interface ScheduleReportService {
    byte[] exportSchedulesToPdf(LocalDate from, LocalDate to);
    byte[] exportSchedulesToExcel(LocalDate from, LocalDate to);
}
```

`AppointmentService` bây giờ chỉ inject `ScheduleAvailabilityService`. Unit test chỉ cần mock hai method thực sự liên quan. Khi admin team thêm tính năng mới vào `ScheduleAdminService` — `AppointmentService` không biết gì, không cần recompile, không cần retest.

---

## Implementation vẫn là một class

Một câu hỏi hay xuất hiện ở đây: nếu tách thành bốn interface, có phải viết bốn implementation riêng không?

Không nhất thiết. Implementation có thể implement nhiều interface:

```java
// Một implementation, nhiều interface
@Service
public class DoctorScheduleServiceImpl implements 
    DoctorScheduleManagementService,
    ScheduleAvailabilityService,
    ScheduleAdminService,
    ScheduleReportService {

    // Implement tất cả methods từ bốn interface
    // Nhưng mỗi caller chỉ thấy phần nó cần
    
    @Override
    public List<AvailableSlotResponse> getAvailableSlots(UUID doctorId, LocalDate date) {
        return scheduleRepository.findAvailableSlots(doctorId, date)
            .stream()
            .map(mapper::toAvailableSlot)
            .toList();
    }
    
    // ... các method khác
}
```

`AppointmentService` inject `ScheduleAvailabilityService` — nhận được `DoctorScheduleServiceImpl` nhưng chỉ thấy hai methods của `ScheduleAvailabilityService`. Không cần biết class thật sự là gì.

---

## ISP và design của DTO / Response object

ISP không chỉ áp dụng cho interface. Nó cũng áp dụng cho data contracts — DTO, response object.

Bạn đã từng viết một `DoctorResponse` chứa tất cả thông tin về doctor rồi dùng nó ở khắp nơi chưa?

```java
// ❌ Vấn đề — một DTO cho mọi use case
public class DoctorResponse {
    private UUID id;
    private String name;
    private String specialization;
    private String email;
    private String phone;
    private String licenseNumber;
    private List<String> qualifications;
    private List<ScheduleResponse> schedules; // có thể là N+1 query
    private Double averageRating;
    private Integer totalPatients;
    private DepartmentResponse department; // thêm một join
    // ...
}
```

Bệnh nhân booking appointment chỉ cần `id`, `name`, `specialization`, `averageRating`. Nhưng bạn đang load `licenseNumber`, `qualifications`, `schedules`, `totalPatients`, `department` — tất cả chỉ để hiển thị tên và chuyên khoa trong dropdown.

ISP trong context này: tạo DTO riêng cho từng use case.

```java
// ✅ Tốt hơn — DTO phù hợp với từng nhu cầu
public class DoctorSummaryResponse {       // dùng trong dropdown/search
    private UUID id;
    private String name;
    private String specialization;
    private Double averageRating;
}

public class DoctorDetailResponse {        // dùng trong profile page
    private UUID id;
    private String name;
    private String specialization;
    private String email;
    private List<String> qualifications;
    private DepartmentResponse department;
}

public class DoctorAdminResponse {         // dùng trong admin dashboard
    private UUID id;
    private String name;
    private String licenseNumber;
    private Integer totalPatients;
    private Boolean isActive;
}
```

Đây cũng là lý do tại sao trong HMS bạn có `mapper.toSummaryResponse()`, `mapper.toDetailResponse()`, `mapper.toAdminResponse()` — mỗi cái phục vụ một use case cụ thể, không phải một DTO "all-in-one" cho mọi caller.

---

## Cách nhận biết interface đang quá béo

Khi bạn implement một interface và thấy mình viết bất kỳ cái này:

```java
@Override
public void bulkUpdateStatus(List<UUID> ids, ScheduleStatus status) {
    throw new UnsupportedOperationException("Not applicable for this context");
}
```

Đó là dấu hiệu rõ ràng nhất: bạn đang bị ép implement thứ bạn không cần. Interface cần được tách.

Dấu hiệu tế nhị hơn: khi test setup trở nên nặng nề vì phải mock quá nhiều method không liên quan đến thứ đang được test. Nếu bạn đang mock mười methods chỉ để test hai methods, interface đang quá to.

---

## Takeaway

Nhìn vào một interface bạn đang dùng và hỏi: *"Bao nhiêu phần trăm methods trong interface này mình thực sự dùng?"* Nếu dưới 60% — interface đó đang quá béo và bạn đang phụ thuộc vào contract mà bạn không cần. Tách nó ra trước khi nó phình to thêm.

---

*Bài tiếp theo: DIP — business code mà phụ thuộc DB thì sớm muộn cũng khổ*
