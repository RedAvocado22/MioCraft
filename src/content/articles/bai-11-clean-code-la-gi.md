---
title: "Clean Code không phải code hoàn hảo — là code sống sót qua thời gian"
description: "Clean Code không phải là code đẹp hay code ngắn. Đó là code mà người khác có thể đọc, hiểu, và thay đổi mà không cần hỏi tác giả."
category: programming
pubDate: 2024-01-11
series: "Phần 2: Clean Code"
tags: ["clean-code", "maintainability", "readability"]
---

Có một khoảnh khắc mà hầu hết dev đều trải qua: mày mở lại một file mình viết sáu tháng trước, nhìn vào và không hiểu tại sao mình lại viết như vậy. Không phải vì code sai — nó vẫn chạy. Mà vì không còn ai đọc được nó nữa, kể cả tác giả.

Đây là lúc mày bắt đầu hiểu Clean Code thực sự là gì.

## "Clean" không có nghĩa là hoàn hảo

Sinh viên hay có một hiểu lầm rất phổ biến: Clean Code = code đẹp, code không có bug, code được viết bởi người giỏi. Nên khi nghe "viết Clean Code đi," phản ứng đầu tiên là lo — lo rằng mình chưa đủ giỏi để viết "clean."

Thực ra định nghĩa đúng đơn giản hơn nhiều: **Clean Code là code mà một developer khác có thể đọc hiểu và sửa được mà không cần hỏi mày.**

Không phải code chạy nhanh nhất. Không phải code dùng ít line nhất. Không phải code thể hiện mày biết nhiều design pattern nhất.

Code sống sót qua thời gian — khi mày off, khi mày nghỉ việc, khi teammate mới join, khi chính mày quay lại sau ba tháng không nhìn vào nó.

## Cái giá của code "chạy được nhưng không clean"

Nhìn vào đây:

```java
// ❌ Vấn đề
public List<Appointment> getA(Long id, String s, boolean b) {
    List<Appointment> result = new ArrayList<>();
    for (Appointment a : appointmentRepo.findAll()) {
        if (a.getDoctorId().equals(id) && a.getStatus().equals(s)) {
            if (b) {
                if (a.getDate().isAfter(LocalDate.now())) result.add(a);
            } else {
                result.add(a);
            }
        }
    }
    return result;
}
```

Code này chạy được. Tao đảm bảo. Nhưng hỏi mày ba câu:

- `b` là cái gì? `true` hay `false` thì nên truyền vào?
- Tại sao lại `findAll()` rồi filter trong Java thay vì filter ở database?
- Sáu tháng sau mày có dám sửa function này không mà không sợ break thứ khác?

Bây giờ nhìn version này:

```java
// ✅ Tốt hơn
public List<Appointment> getUpcomingAppointmentsByDoctor(Long doctorId, AppointmentStatus status) {
    return appointmentRepository.findByDoctorIdAndStatusAndDateAfter(
        doctorId,
        status,
        LocalDate.now()
    );
}
```

Ngắn hơn, rõ hơn, và bỏ luôn cái bug tiềm ẩn là `findAll()` kéo toàn bộ data về memory. Không phải vì tao "giỏi hơn" — mà vì tao nghĩ đến người đọc tiếp theo.

## "Code cho người đọc, không phải cho máy chạy"

Máy không quan tâm mày đặt tên biến là `x` hay `appointmentDate`. Nó chạy cả hai. Người đọc tiếp theo thì quan tâm rất nhiều.

Trong một hệ thống thực tế như HMS, một AppointmentService có thể được đọc bởi: mày, teammate, senior review PR, junior mới join sau mày. Tất cả họ đều phải đọc code này mà không có mày ngồi cạnh giải thích.

Đây là lý do tại sao Uncle Bob viết trong Clean Code: *"The ratio of time spent reading versus writing is well over 10 to 1."* Mày dành 1 giờ viết, nhưng cả team tốn 10 giờ đọc và hiểu nó trong vòng đời của codebase.

Khi nghĩ như vậy, "đặt tên biến cho rõ" không còn là chuyện nhỏ nhặt nữa.

## Vậy Clean Code gồm những gì?

Không phải một checklist. Là một mindset. Nhưng nếu phải cụ thể hóa, nó gồm mấy thứ cốt lõi:

**Tên nói lên ý định.** Không phải `data`, `result`, `temp`. Tên phải trả lời câu hỏi: đây là cái gì, nó đại diện cho điều gì trong domain.

**Function làm đúng một việc.** Không phải "một function một trang code" — mà là một function có một lý do để thay đổi. Chi tiết tao sẽ nói ở Bài 13.

**Không có surprise.** Code làm đúng những gì tên nó nói. `getPatientById` không gọi thêm Keycloak bên trong. `calculateInsuranceCoverage` không tự gửi notification.

**Error không bị nuốt.** Exception bị catch rồi không làm gì là một trong những nguồn bug khó debug nhất. Bài 17 sẽ đào sâu vào cái này.

**Test được.** Nếu code không test được, nghĩa là nó đang có quá nhiều dependency ẩn, quá nhiều side effect. Không test được = không thể chứng minh nó đúng.

## Một thứ hay bị nhầm lẫn

Clean Code không phải là không có comment. Không phải là code ngắn nhất có thể. Không phải là không dùng design pattern.

Và quan trọng nhất: **Clean Code không phải là không có technical debt.**

Mày vẫn sẽ có những chỗ viết tạm vì deadline. Vẫn có những chỗ chưa refactor xong. Điều quan trọng là mày *biết* những chỗ đó là debt, và mày có kế hoạch trả — không phải để nó mục đi trong codebase cho đến khi không ai dám đụng vào.

Clean Code là code mà debt của nó *rõ ràng* và *có thể kiểm soát được* — không phải code không có debt.

## Takeaway

Lần tới trước khi commit, thử một bài test nhỏ: đưa file này cho người khác trong team, không giải thích gì cả, và hỏi họ function này làm gì. Nếu họ cần hỏi lại — đó là code cần refactor, không phải người đọc cần học thêm.

---

*Bài tiếp theo: Đặt tên biến là kỹ năng, không phải thói quen*
