---
title: "LSP — kế thừa sai còn nguy hiểm hơn code xấu"
description: "Liskov Substitution Principle: subclass phải thay thế được superclass mà không làm hỏng chương trình. Vi phạm LSP là nguồn gốc của những bug khó tìm nhất."
category: programming
pubDate: 2024-02-05
series: "Phần 4: SOLID"
tags: ["SOLID", "LSP", "inheritance"]
---

Kế thừa là thứ đầu tiên bạn học trong OOP. `extends`, `override`, `super()` — cảm giác rất powerful. Bạn có thể tạo một `Animal`, rồi `Dog extends Animal`, `Cat extends Animal`. Clean, elegant, có hierarchy rõ ràng.

Nhưng đây là vấn đề: kế thừa rất dễ bị dùng sai. Và khi bị dùng sai, nó tạo ra một loại bug khó chịu nhất — không có exception, không có compile error, nhưng behavior của hệ thống không đúng như bạn nghĩ.

**Liskov Substitution Principle** là nguyên tắc phát hiện ra điều đó.

---

## Nguyên tắc nói gì

Barbara Liskov phát biểu năm 1987: *"Nếu S là subtype của T, thì objects của type T trong một program có thể được thay thế bằng objects của type S mà không làm thay đổi bất kỳ property đúng đắn nào của program đó."*

Dịch sang tiếng người: **nếu bạn có code đang dùng class cha, bạn phải có thể swap nó bằng bất kỳ subclass nào mà không cần biết mình đang dùng subclass nào — và mọi thứ vẫn phải hoạt động đúng.**

Nếu subclass làm hỏng kỳ vọng đó — kế thừa đang được dùng sai.

---

## Ví dụ cổ điển — và tại sao nó vẫn xảy ra trong production

HMS có `BaseScheduleValidator` dùng để validate logic chung cho doctor schedule:

```java
// Class cha — contract rõ ràng
public class ScheduleValidator {
    
    public void validate(DoctorSchedule schedule) {
        if (schedule.getMaxPatients() <= 0) {
            throw new ValidationException("maxPatients must be positive");
        }
        if (schedule.getDate().isBefore(LocalDate.now())) {
            throw new ValidationException("Schedule date cannot be in the past");
        }
    }
}
```

Sau đó bạn thêm loại schedule đặc biệt cho emergency — không cần validate ngày tháng vì emergency có thể được tạo cho ngày hôm nay hoặc ngày hôm qua:

```java
// ❌ Vấn đề — subclass đang thay đổi behavior đã được định nghĩa ở parent
public class EmergencyScheduleValidator extends ScheduleValidator {
    
    @Override
    public void validate(DoctorSchedule schedule) {
        // Chỉ validate maxPatients, bỏ qua date validation
        if (schedule.getMaxPatients() <= 0) {
            throw new ValidationException("maxPatients must be positive");
        }
        // Không validate date — vì emergency schedule có thể là past date
    }
}
```

Về mặt compile: không có lỗi. Về mặt runtime: không có exception ngay lập tức. Nhưng bất kỳ đoạn code nào đang dùng `ScheduleValidator` với kỳ vọng rằng *"sau khi validate, date chắc chắn không phải past date"* — sẽ bị phá vỡ khi được inject `EmergencyScheduleValidator` thay vào đó.

```java
// Code này assume rằng schedule đã được validate đầy đủ
@Service
public class ScheduleService {
    
    private final ScheduleValidator validator; // inject gì vào đây?

    public DoctorSchedule createSchedule(CreateScheduleRequest request) {
        DoctorSchedule schedule = mapper.toEntity(request);
        validator.validate(schedule); // nếu là EmergencyScheduleValidator, date không được check
        
        // Code phía dưới assume date đã valid...
        notifyDoctorOfUpcomingSchedule(schedule); // gửi reminder 24h trước — nhưng schedule có thể là yesterday
        return scheduleRepository.save(schedule);
    }
}
```

Đây là vi phạm LSP: `EmergencyScheduleValidator` không thể thay thế `ScheduleValidator` một cách an toàn — behavior đã thay đổi theo cách caller không mong đợi.

---

## Cách nhận biết vi phạm LSP

Ba pattern phổ biến nhất:

**Pattern 1 — Override để throw exception:** Subclass override một method và throw `UnsupportedOperationException` thay vì implement nó. Ví dụ cổ điển trong Java: `java.util.Stack extends Vector` — Stack implement `add(int index, E element)` từ Vector nhưng lại throw exception vì Stack không cho phép insert theo index. Nếu code của bạn expect `Vector` và nhận được `Stack`, nó sẽ blow up.

```java
// ❌ Dấu hiệu vi phạm LSP
public class ReadOnlyMedicalRecord extends MedicalRecord {
    
    @Override
    public void update(MedicalRecordData data) {
        throw new UnsupportedOperationException("This record is read-only");
        // Caller không biết điều này cho đến khi runtime
    }
}
```

**Pattern 2 — Strengthen preconditions:** Subclass đặt điều kiện đầu vào nghiêm ngặt hơn parent. Parent accept `amount >= 0`, subclass chỉ accept `amount > 100`. Code dùng parent sẽ truyền vào giá trị 50 mà không biết mình đang sai.

**Pattern 3 — Weaken postconditions:** Subclass trả về kết quả lỏng lẻo hơn parent. Parent đảm bảo return list không null, subclass có thể return null trong một số case. Caller của parent sẽ không `null-check` vì parent không bao giờ trả về null.

---

## Giải pháp — khi nào thì kế thừa, khi nào thì composition

Với ví dụ `EmergencyScheduleValidator`, vấn đề là emergency schedule không phải là một loại schedule thông thường đã được validate — nó là một loại schedule với *validation rules khác nhau*. Đây không phải quan hệ "is-a", đây là "has different rules".

```java
// ✅ Tốt hơn — tách ra thay vì kế thừa
public interface ScheduleValidator {
    void validate(DoctorSchedule schedule);
}

@Component
public class StandardScheduleValidator implements ScheduleValidator {
    
    @Override
    public void validate(DoctorSchedule schedule) {
        validateMaxPatients(schedule);
        validateDateNotInPast(schedule);
    }
}

@Component
public class EmergencyScheduleValidator implements ScheduleValidator {
    
    @Override
    public void validate(DoctorSchedule schedule) {
        validateMaxPatients(schedule);
        // Emergency có thể là past date — không validate date
        // Nhưng phải validate những thứ khác đặc thù cho emergency
        validateEmergencyReason(schedule);
    }
}
```

Bây giờ không có kế thừa từ class cha. Cả hai đều implement cùng interface — contract rõ ràng — nhưng implementation độc lập. Caller biết mình đang dùng `ScheduleValidator`, nhưng hai implementations không bắt buộc phải có behavior giống nhau, chỉ cần fulfill interface contract.

---

## LSP và tư duy "is-a"

Bài học thực tế là: **"is-a" trong ngôn ngữ tự nhiên không phải lúc nào cũng đúng trong code.**

*"EmergencySchedule là một Schedule"* — đúng trong ngôn ngữ tự nhiên.

Nhưng trong code, câu hỏi cần hỏi là: *"EmergencySchedule có hoàn toàn thay thế được Schedule ở mọi chỗ Schedule được dùng không, với behavior không bị phá vỡ?"* Nếu không — kế thừa là sai công cụ.

Trong HMS, bạn có `DoctorEmployee` và `StaffEmployee` — cả hai đều là `Employee`. Nếu mọi behavior của `Employee` đều đúng với cả hai, kế thừa hợp lý. Nhưng nếu một ngày nào đó `DoctorEmployee.calculateSalary()` bắt đầu có logic hoàn toàn khác — xem xét lại liệu kế thừa còn phù hợp không, hay nên switch sang composition với shared interface.

---

## Takeaway

Trước khi viết `extends`, hỏi: *"Subclass của mình có thể được swap vào bất kỳ đâu đang dùng class cha không — mà không ai biết sự khác biệt?"* Nếu subclass cần throw exception cho một method, hoặc cần silently bỏ qua một behavior từ parent — đó không phải kế thừa, đó là hack. Composition hoặc interface mới là lựa chọn đúng.

---

*Bài tiếp theo: ISP — interface càng to, code càng yếu*
