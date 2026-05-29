---
title: "Code chạy được vẫn bị reject — và đây là lý do"
description: "Viết code pass test chưa đủ. Senior reject PR không phải vì code sai — mà vì code không thể sống cùng hệ thống theo thời gian."
category: programming
pubDate: 2024-01-01
series: "Phần 1: Tư duy lập trình"
tags: ["mindset", "code-review", "clean-code"]
---

Lần đầu tiên bị reject code review, cảm giác rất lạ.

Mày viết một cái service, test thủ công, endpoint trả về đúng data, không có exception nào bắn ra. Mọi thứ hoạt động. Mày tự tin mở pull request. Rồi senior comment một tràng — không phải về logic, không phải về bug — mà về cách mày đặt tên biến, cách mày chia hàm, cách mày tổ chức code.

Cảm giác đầu tiên là: *"Ủa nhưng nó chạy mà?"*

Đó là moment mày bắt đầu hiểu ra một thứ quan trọng: **production code không chỉ cần chạy được. Nó cần sống sót qua thời gian.**

---

## "Chạy được" và "tốt" là hai tiêu chí khác nhau

Khi mày còn là sinh viên, tiêu chí duy nhất để đánh giá code là: *có ra đúng output không?* Thầy giáo chấm bài dựa trên test case. Code pass hết test case là điểm cao. Không ai hỏi mày đặt tên biến như thế nào, không ai hỏi cái function dài 200 dòng kia có nên tách ra không.

Môi trường production khác hoàn toàn. Code mày viết hôm nay sẽ được:

- **Đọc lại bởi chính mày** — 3 tháng sau mày không còn nhớ mày đang nghĩ gì lúc viết nó
- **Đọc bởi người khác** — teammate, người join sau, người maintain sau khi mày rời đi
- **Sửa đổi nhiều lần** — requirement thay đổi, bug cần fix, feature cần thêm
- **Debug lúc production down** — lúc 2 giờ sáng, hệ thống đang sập, mày cần hiểu code ngay lập tức

Với bốn trường hợp đó, code "chạy được" là điều kiện cần, không phải điều kiện đủ.

---

## Hai chiều của chất lượng code

Có một cách đơn giản để nhìn code quality: chia làm hai chiều.

**Chiều 1 — Correctness:** Code có làm đúng những gì nó được yêu cầu không? Đây là thứ mày đang kiểm tra khi chạy test thủ công.

**Chiều 2 — Maintainability:** Code có dễ hiểu, dễ sửa, dễ mở rộng không? Đây là thứ senior đang đánh giá trong code review.

Sinh viên thường chỉ tối ưu chiều 1. Senior care về cả hai — và trong nhiều trường hợp, maintainability quan trọng hơn vì nó ảnh hưởng đến tốc độ của cả team trong dài hạn.

Một đoạn code khó đọc không chỉ tốn thời gian của người đọc. Nó còn tăng xác suất introduce bug khi sửa, vì người sửa không hiểu đủ sâu để biết mình đang thay đổi gì.

---

## Ví dụ thực tế — cùng một logic, hai cách viết

Đây là một đoạn code thật từ một HMS service — tìm doctor schedule khả dụng:

```java
// Version 1 — chạy được
public List<DoctorScheduleResponse> getAvailable(UUID id, LocalDate d) {
    List<DoctorSchedule> list = repo.findAll();
    List<DoctorScheduleResponse> result = new ArrayList<>();
    for (DoctorSchedule s : list) {
        if (s.getDoctor().getId().equals(id) && s.getDate().equals(d) && s.isActive()) {
            if (s.getCurrentPatients() < s.getMaxPatients()) {
                result.add(mapper.toResponse(s));
            }
        }
    }
    return result;
}
```

```java
// Version 2 — chạy được VÀ maintainable
public List<DoctorScheduleResponse> getAvailableSchedules(UUID doctorId, LocalDate date) {
    return scheduleRepository
        .findByDoctorIdAndDateAndActiveTrue(doctorId, date)
        .stream()
        .filter(DoctorSchedule::hasAvailableSlots)
        .map(scheduleMapper::toResponse)
        .toList();
}
```

Cả hai đều trả về kết quả đúng. Nhưng version 2:

- Tên method nói rõ nó làm gì (`getAvailableSchedules` vs `getAvailable`)
- Tên params nói rõ ý nghĩa (`doctorId`, `date` vs `id`, `d`)
- Logic lọc nằm ở đúng chỗ — `hasAvailableSlots()` là method của entity, không phải raw comparison nằm trong service
- `findAll()` đã biến mất — không ai load toàn bộ schedule table chỉ để filter trong memory

Người đọc version 2 lần đầu tiên hiểu ngay mà không cần đọc từng dòng. Người đọc version 1 phải trace qua từng điều kiện để hiểu business logic đang làm gì.

---

## Điều senior thực sự đánh giá trong code review

Khi senior review code của mày, họ không chỉ hỏi "nó có chạy không?" — họ đang hỏi:

**"Nếu tao phải maintain cái này lúc 2 giờ sáng khi production đang down, tao có hiểu được nó trong 30 giây không?"**

Và nếu câu trả lời là không, họ sẽ reject — dù code có chạy đúng đến đâu.

Đây không phải senior đang khó tính. Đây là experience nói chuyện. Họ đã từng ngồi debug lúc 2 giờ sáng với một đoạn code mà tác giả không còn làm ở đó nữa. Họ biết cái giá của code khó đọc là bao nhiêu.

---

## Takeaway

Code chạy được là điểm khởi đầu, không phải điểm đích. Mỗi lần mày viết xong một đoạn code và nó chạy đúng, hãy dừng lại và hỏi một câu: *"Nếu tao không nhớ gì về context này, tao có đọc hiểu nó trong 2 phút không?"*

Nếu không — đó là lúc bắt đầu refactor, không phải lúc merge.

---

*Bài tiếp theo: Junior nghĩ về feature. Senior nghĩ về change.*
