---
title: "Junior nghĩ về feature. Senior nghĩ về change"
description: "Sự khác biệt không nằm ở kỹ thuật — mà ở cách nhìn vào một yêu cầu: bạn đang giải quyết hôm nay hay đang thiết kế cho tương lai?"
category: programming
pubDate: 2024-01-02
series: "Phần 1: Tư duy lập trình"
tags: ["mindset", "senior", "junior"]
---

Có một câu hỏi tao thấy senior hay hỏi nhau trước khi bắt đầu implement một thứ gì đó: *"Cái này sau này thay đổi như thế nào?"*

Không phải "nó hoạt động thế nào?" Không phải "làm sao để implement nó?" Mà là: **nó sẽ thay đổi như thế nào, và code của tao có chịu được sự thay đổi đó không?**

Junior không hỏi câu này — không phải vì họ lười, mà vì họ chưa từng đau đủ nhiều khi requirement thay đổi và toàn bộ code phải viết lại.

---

## Requirement luôn thay đổi — đây không phải bi kịch, đây là sự thật

Trong trường, requirement được đưa ra một lần và không đổi. Đó là lý do sinh viên hay viết code theo kiểu "đủ để pass đề bài" — vì đề bài không bao giờ thay đổi sau khi nộp.

Trong thực tế, requirement thay đổi liên tục. Không phải vì khách hàng không biết họ muốn gì — mà vì thị trường thay đổi, người dùng dùng sản phẩm theo cách không ai đoán trước được, và business cần adapt.

Vấn đề không phải là *liệu* requirement có thay đổi không. Vấn đề là *khi* nó thay đổi, code của mày có dễ thay đổi theo không?

---

## Ví dụ thực tế — ShiftType trong HMS

Trong một HMS, ban đầu doctor schedule chỉ có hai ca: sáng và chiều. Code được viết như này:

```java
public boolean isAvailable(DoctorSchedule schedule) {
    LocalTime now = LocalTime.now();
    if (schedule.getShiftType().equals("MORNING")) {
        return now.isBefore(LocalTime.of(12, 0));
    } else {
        return now.isBefore(LocalTime.of(18, 0));
    }
}
```

Sau đó requirement thay đổi: thêm ca tối (19:00 - 22:00). Giờ mày phải tìm khắp codebase tất cả những chỗ nào đang hardcode logic của shift, sửa từng chỗ một, và cầu trời không sót chỗ nào.

Nếu ngay từ đầu mày nghĩ đến sự thay đổi, code sẽ trông khác:

```java
public enum ShiftType {
    MORNING(LocalTime.of(7, 0), LocalTime.of(12, 0)),
    AFTERNOON(LocalTime.of(13, 0), LocalTime.of(18, 0)),
    EVENING(LocalTime.of(19, 0), LocalTime.of(22, 0));

    private final LocalTime start;
    private final LocalTime end;

    ShiftType(LocalTime start, LocalTime end) {
        this.start = start;
        this.end = end;
    }

    public boolean isCurrentlyActive() {
        LocalTime now = LocalTime.now();
        return !now.isBefore(start) && now.isBefore(end);
    }
}
```

Bây giờ khi thêm ca mới, mày chỉ cần thêm một entry vào enum. Không phải tìm khắp codebase. Không phải sợ sót. Logic nằm đúng chỗ — bên trong `ShiftType`, không phải rải rác khắp các service.

---

## "Nghĩ về change" không có nghĩa là over-engineer

Đây là điểm dễ hiểu lầm nhất.

Nghĩ về change không có nghĩa là mày phải thiết kế cho mọi trường hợp có thể xảy ra. Không có nghĩa là mày phải add abstraction layer cho mọi thứ vì "biết đâu sau này cần."

Nghĩ về change có nghĩa là: **nhìn vào code mày vừa viết, xác định những chỗ nào có nhiều khả năng thay đổi nhất, và đảm bảo những chỗ đó dễ sửa.**

Trong ví dụ trên, ShiftType là thứ rõ ràng có thể thay đổi — business rules về ca làm việc thường xuyên được điều chỉnh. Đó là lý do đáng để invest vào một cái enum có behavior, thay vì hardcode string khắp nơi.

Ngược lại, nếu có một thứ gần như chắc chắn không bao giờ thay đổi, mày không cần over-engineer nó. Không phải mọi thứ đều cần abstract.

---

## Câu hỏi mày nên hỏi trước khi viết code

Trước khi implement một feature, dừng lại và hỏi ba câu:

**1. Phần nào của requirement này có khả năng thay đổi nhất?**
Business rules, pricing logic, workflow states, notification channels — những thứ này thường xuyên thay đổi. Database schema, core domain entities — ít thay đổi hơn.

**2. Nếu phần đó thay đổi, tao phải sửa bao nhiêu chỗ?**
Nếu câu trả lời là "nhiều chỗ" — đó là signal để refactor ngay bây giờ, trước khi code đó lan ra khắp codebase.

**3. Sự thay đổi đó có dễ test không?**
Code dễ thay đổi thường đi kèm với code dễ test. Nếu mày không thể test một đoạn logic mà không spin up cả database, khả năng cao là logic đó đang nằm sai chỗ.

---

## Senior không code nhanh hơn — họ code ít phải sửa lại hơn

Một quan sát thực tế: senior thường code chậm hơn junior ở giai đoạn đầu của một feature. Họ dừng lại nhiều hơn, suy nghĩ nhiều hơn, đôi khi vẽ diagram trước khi viết dòng code đầu tiên.

Nhưng khi requirement thay đổi — và nó sẽ thay đổi — senior mất 30 phút để adapt. Junior mất 3 ngày để refactor lại từ đầu.

Tốc độ thật sự của một developer không đo bằng số dòng code viết ra mỗi ngày. Nó đo bằng tốc độ deliver feature cuối cùng đến tay người dùng, bao gồm cả thời gian fix bug và refactor do thiết kế kém.

---

## Takeaway

Mỗi lần mày implement một feature, đừng chỉ hỏi "làm sao để nó chạy?" Hãy hỏi thêm: *"Thứ nào trong này có khả năng thay đổi? Và nếu nó thay đổi, tao mất bao lâu để sửa?"*

Câu trả lời cho câu hỏi thứ hai sẽ cho mày biết mày cần đầu tư thêm vào thiết kế ở chỗ nào.

---

*Bài tiếp theo: Câu hỏi senior hỏi trước khi viết dòng code đầu tiên.*
