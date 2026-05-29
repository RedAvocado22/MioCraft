---
title: "Đặt tên biến là kỹ năng, không phải thói quen"
description: "Một cái tên tốt loại bỏ nhu cầu comment. Một cái tên xấu là nguồn gốc của mọi hiểu lầm trong codebase."
category: programming
pubDate: 2024-01-12
series: "Phần 2: Clean Code"
tags: ["clean-code", "naming", "readability"]
---

Tao từng review một codebase mà trong đó có một biến tên là `data2`. Không phải `data2` ở scope nhỏ, không phải trong vòng lặp. Là một field cấp class, được dùng ở tám chỗ khác nhau trong service. Khi tao hỏi tác giả "cái này là gì," anh ấy suy nghĩ mất bốn giây rồi nói: "À, đó là danh sách bệnh nhân đã thanh toán xong."

Vậy tại sao không đặt tên nó là `paidPatients`?

## Tên xấu không phải vì lười — mà vì không nghĩ đủ

Phần lớn tên biến tệ không xuất phát từ việc dev lười biếng. Nó xuất phát từ việc đặt tên *trước khi hiểu rõ* cái mình đang xây dựng. Mày đang code, cần một biến để chứa tạm cái gì đó, gõ `temp` rồi tiếp tục. Sau đó nó nằm đó mãi.

Hoặc ngược lại: mày đặt tên quá sớm khi domain chưa rõ. Gọi là `result` vì chưa biết nó là gì. Sau khi logic rõ ra thì không quay lại đổi nữa.

Đặt tên tốt đòi hỏi mày phải hiểu cái mình đang xây dựng trước khi đặt tên. Đó là lý do nó là kỹ năng — không phải thói quen.

## Ba câu hỏi để đặt tên tốt

**Câu 1: Nó là gì trong domain?**

Đừng đặt tên theo kiểu dữ liệu hay cấu trúc — đặt theo ý nghĩa trong bài toán.

```java
// ❌ Vấn đề — đặt theo cấu trúc
List<Long> ids;
Map<String, Object> map;
int count;

// ✅ Tốt hơn — đặt theo domain
List<Long> eligibleDoctorIds;
Map<String, AppointmentStatus> statusByAppointmentCode;
int pendingAppointmentCount;
```

**Câu 2: Ai sẽ đọc tên này, và họ cần biết gì?**

Tên không cần chứa mọi thông tin — chỉ cần đủ để người đọc tiếp theo không phải đặt câu hỏi.

```java
// ❌ Vấn đề — quá ngắn, mất context
LocalDate d;
boolean flag;
String s;

// ❌ Cũng là vấn đề — quá dài, nhiễu
LocalDate theDateOnWhichTheAppointmentIsScheduledToOccur;

// ✅ Tốt hơn — vừa đủ, rõ ý
LocalDate appointmentDate;
boolean isInsuranceVerified;
String patientPhoneNumber;
```

**Câu 3: Tên này có nói dối không?**

Tên nói dối còn tệ hơn tên mơ hồ. Nếu `getActivePatients()` thực ra trả về tất cả patient kể cả inactive — tên đó đang nói dối. Ai đọc vào sẽ tin tưởng và viết code dựa trên cái tin tưởng đó. Đây là nguồn gốc của những bug rất khó tìm.

```java
// ❌ Vấn đề — tên nói dối
// Thực ra trả về tất cả, không filter active
public List<Patient> getActivePatients() {
    return patientRepository.findAll();
}

// ✅ Tốt hơn — tên khớp với hành vi
public List<Patient> getAllPatients() {
    return patientRepository.findAll();
}

public List<Patient> getActivePatients() {
    return patientRepository.findByStatus(PatientStatus.ACTIVE);
}
```

## Tên trong các context khác nhau

Quy tắc đặt tên không uniform cho mọi context.

**Vòng lặp ngắn:** `i`, `j` là chấp nhận được — mọi người đều hiểu convention này.

```java
for (int i = 0; i < doctors.size(); i++) { ... }
```

**Lambda và stream:** Đặt tên parameter cho rõ, đặc biệt khi chain nhiều bước.

```java
// ❌ Vấn đề — d là gì? a là gì?
doctors.stream()
    .filter(d -> d.isAvailable())
    .flatMap(d -> d.getAppointments().stream())
    .filter(a -> a.getStatus() == PENDING)
    .collect(toList());

// ✅ Tốt hơn
doctors.stream()
    .filter(Doctor::isAvailable)
    .flatMap(doctor -> doctor.getAppointments().stream())
    .filter(appointment -> appointment.getStatus() == PENDING)
    .collect(toList());
```

**Boolean:** Luôn dùng prefix `is`, `has`, `can`, `should`. Boolean đặt tên sai là nguồn gốc của logic ngược.

```java
// ❌ Vấn đề — không rõ true nghĩa là gì
boolean insurance;
boolean status;
boolean verified;

// ✅ Tốt hơn
boolean hasInsurance;
boolean isActive;
boolean isInsuranceVerified;
```

Bài 15 sẽ nói sâu hơn về vấn đề boolean flag — nhưng tên là phần đầu tiên cần đúng.

**Method name:** Phải là verb hoặc verb phrase. Và cần nói rõ nó trả về gì hay làm gì.

```java
// ❌ Vấn đề — không rõ hành động
appointment();
insurance(Long id);
doctor(String code, boolean b);

// ✅ Tốt hơn
createAppointment(AppointmentRequest request);
verifyInsuranceCoverage(Long patientId);
findAvailableDoctorBySpecialty(String specialtyCode, boolean acceptsWalkIn);
```

## Tên trong HMS cụ thể — một ví dụ thực tế

Trong codebase HMS, tao thấy pattern này khá phổ biến:

```java
// ❌ Vấn đề — dto là gì? map sang gì?
public AppointmentDTO map(Appointment a) { ... }
public void process(AppointmentDTO dto) { ... }
public List<Object> getData(Long id) { ... }
```

Mỗi cái tên này đều mơ hồ theo cách riêng. `map` là map gì sang gì? `process` xử lý theo nghĩa nào? `getData` trả về data của cái gì?

Refactor nhẹ:

```java
// ✅ Tốt hơn
public AppointmentDTO toDTO(Appointment appointment) { ... }
public void confirmAppointmentAndNotifyPatient(AppointmentDTO appointmentDTO) { ... }
public List<AppointmentSlot> getAvailableSlotsByDoctorId(Long doctorId) { ... }
```

`confirmAppointmentAndNotifyPatient` dài hơn — nhưng đó là dấu hiệu function này đang làm *hai việc*. Bài 13 sẽ bắt đầu từ đây.

## Một quy tắc nhỏ nhưng cực kỳ hữu ích

Nếu mày phải thêm comment để giải thích tên biến — nghĩa là tên biến đó chưa đủ tốt.

```java
// ❌ Vấn đề — phải dùng comment để bù cho tên xấu
int d; // số ngày kể từ lần khám cuối

// ✅ Tốt hơn — tên tự giải thích
int daysSinceLastVisit;
```

Comment nên giải thích *tại sao*, không phải *là gì*. Nếu mày đang dùng comment để giải thích "cái này là gì" — đó là warning.

## Takeaway

Lấy một class bất kỳ trong HMS mày đang viết, đọc qua tất cả tên biến và method. Với mỗi cái, thử đặt câu hỏi: nếu tao xóa toàn bộ comment và chỉ giữ lại tên — người đọc có hiểu được không? Bao nhiêu cái cần đổi tên?

---

*Bài tiếp theo: Function làm "một việc" — nhưng "một việc" nghĩa là gì?*
