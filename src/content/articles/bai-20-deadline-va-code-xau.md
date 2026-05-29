---
title: "Deadline dí không cho phép mày viết code bừa — thực ra là sao?"
description: "Deadline không phải lý do để viết code xấu — đó là lý do để viết code đơn giản hơn. Hai thứ này khác nhau hoàn toàn."
category: programming
pubDate: 2024-01-20
series: "Phần 2: Clean Code"
tags: ["mindset", "deadline", "technical-debt"]
---

"Deadline gấp nên tao phải viết tạm" — câu này tao nghe nhiều đến mức nó trở thành một cụm từ phản xạ trong ngành. Dev nói nó. Senior nói nó. Tech lead nói nó. Và trong nhiều trường hợp, nó đúng theo một nghĩa nào đó.

Nhưng có một sự khác biệt rất lớn giữa "viết tạm có ý thức" và "viết bừa vì bận."

## Hai loại code nhanh

Khi deadline dí, mày có hai lựa chọn, và chúng trông giống nhau từ bên ngoài nhưng khác nhau hoàn toàn về hệ quả.

**Loại 1: Tactical shortcut — vay có biết mình đang vay**

Mày skip một số abstraction, hard-code một giá trị tạm, không viết test cho edge case không urgent. Nhưng mày biết mình đang làm gì. Mày comment lại, tạo ticket, hoặc ít nhất là ghi nhớ nó là debt.

```java
// TODO: [TICKET-247] Hiện tại hard-code doctorId cho demo — replace bằng UserContext
// sau khi JWT integration xong. Deadline: sprint 3.
private static final Long DEMO_DOCTOR_ID = 1L;
```

Đây là technical debt có kiểm soát. Giống như mày vay tiền để đầu tư — biết mình đang nợ, có kế hoạch trả.

**Loại 2: Viết bừa — vay mà không biết mình đang vay**

Mày skip validation vì "sau này thêm," duplicate logic vì "copy cho nhanh," bỏ qua exception handling vì "chưa cần." Không comment, không ticket, không nhớ. Hai tháng sau mày không nhận ra đó là debt — nó trông như feature.

```java
// Không comment, không ticket, không ai biết đây là temporary
public void createAppointment(AppointmentRequest request) {
    // Validation bị bỏ qua
    // Duplicate logic từ PatientService.register() nhưng không ai nhớ
    appointmentRepository.save(buildAppointment(request));
}
```

Cái thứ hai không phải "deadline bắt buộc phải vậy." Đó là thiếu discipline.

## Deadline thực sự compress được gì

Khi deadline dí, mày có thể compress:

**Scope.** Tính năng ít hơn, edge case ít hơn, UI đơn giản hơn. Đây là cách đúng — deliver ít hơn nhưng deliver đúng.

**Thoroughness.** Test coverage thấp hơn ở những chỗ ít critical, không viết documentation đầy đủ, không refactor những chỗ chưa đụng vào.

**Abstraction level.** Dùng solution đơn giản thay vì solution elegant — nhưng solution đó phải đúng, phải handle error, phải không tạo ra data corruption.

Deadline KHÔNG compress được:

**Correctness.** Code sai là sai. Code tạo ra inconsistent data dưới load là bug production, không phải "technical debt."

**Error handling cho critical path.** Thanh toán mà không handle failure là không thể deploy, bất kể deadline là khi nào.

**Security.** SQL injection vẫn là SQL injection dù deadline ngày mai.

## Kỹ năng thực sự: triage dưới áp lực

Dev giỏi không phải là người viết code nhanh nhất. Là người biết cái gì cần làm đúng ngay bây giờ và cái gì có thể defer.

Nhìn vào ba thứ:

**1. Nếu cái này sai, data có bị hỏng không?** Nếu có — không được skip.

**2. Nếu cái này sai, security có bị ảnh hưởng không?** Nếu có — không được skip.

**3. Nếu cái này sai, feature có không dùng được không?** Nếu có — không được skip, nhưng có thể simplify.

Còn lại — có thể defer nếu có ticket và comment rõ ràng.

```java
public class AppointmentController {

    @PostMapping
    public ResponseEntity<AppointmentDTO> create(@RequestBody AppointmentRequest request) {
        // TODO: [TICKET-312] Thêm input validation với @Valid sau khi có time
        // Hiện tại chỉ validate critical fields thủ công
        if (request.getDoctorId() == null || request.getPatientId() == null) {
            return ResponseEntity.badRequest().build();
        }

        // Critical path — payment và state transition phải đúng
        AppointmentDTO result = appointmentService.create(request);
        return ResponseEntity.ok(result);
    }
}
```

Validation đầy đủ bị defer — nhưng null check cho critical field vẫn ở đó. Bug vì null pointer không phải là "technical debt" — nó là bug.

## Cái giá thực sự của code bừa

Tao muốn nói cụ thể về cái giá này vì nó hay bị underestimate.

Code bừa không chỉ làm chậm sprint tiếp theo. Nó tạo ra **fear** — dev không dám refactor vì không biết cái gì đang phụ thuộc vào cái gì. Không dám thêm feature vì không hiểu code hiện tại đủ để extend. Không dám fix bug vì fix một chỗ có thể break chỗ khác.

Trong codebase đủ nhiều "viết tạm không kiểm soát," mọi thay đổi đều trở thành gambling. Team bắt đầu spend nhiều thời gian hơn cho manual testing, hotfix, và họp post-mortem hơn là viết feature. Velocity giảm dần. Deadline trở nên càng ngày càng missed hơn.

Đây là paradox: viết code bừa để deliver nhanh hôm nay dẫn đến deliver chậm hơn mãi mãi về sau.

## Điều tao thực sự muốn mày nhớ

Clean Code không phải là luxury của những project không có deadline. Nó là cách duy nhất để một codebase có thể maintain được qua thời gian.

Nhưng "clean" không có nghĩa là perfect. Mày sẽ luôn có debt. Điều quan trọng là:

- Biết mình đang nợ gì
- Debt phải được ghi lại, không được ẩn đi
- Critical path (correctness, security, data integrity) không được compromise
- "Viết tạm" phải là quyết định có ý thức, không phải default behavior khi bận

Code tồn tại lâu hơn sprint. Lâu hơn deadline. Lâu hơn cả những người viết ra nó. Mày đang viết cho người tiếp theo — và trong nhiều trường hợp, người tiếp theo đó là chính mày, sáu tháng sau, lúc 11 giờ đêm đang debug production.

## Takeaway

Sau Phần 2 này, tao muốn mày làm một việc cụ thể: mở codebase HMS, tìm ba chỗ mày biết là "viết tạm" — không có comment, không có ticket, không ai biết ngoài mày. Thêm comment giải thích tại sao nó là tạm, và tại sao chưa fix. Đó là bước đầu tiên để debt trở nên visible và có thể kiểm soát.

---

*Bài tiếp theo: Tại sao Controller/Service/Repository thối theo thời gian*
