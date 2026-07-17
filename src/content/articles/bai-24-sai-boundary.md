---
title: "Sai boundary một ly, hệ thống đi một dặm"
description: "Boundary là ranh giới giữa các phần của hệ thống. Vẽ sai một lần — mọi thứ build lên trên đó đều sai theo."
category: architecture
pubDate: 2024-01-24
series: "Phần 3: Kiến trúc phần mềm"
tags: ["architecture", "boundaries", "clean-architecture"]
---

Trong kiến trúc phần mềm, có một loại quyết định mà bạn đưa ra trong năm phút nhưng phải sống chung với nó trong năm năm. Đó là quyết định về **boundary** — ranh giới giữa các module, service, và domain.

Boundary sai không phải lúc nào cũng gây bug ngay lập tức. Nó gây ra một thứ tệ hơn: mỗi lần thêm feature, bạn phải sửa code ở ba nơi thay vì một. Mỗi lần một thứ thay đổi, bạn không chắc còn thứ gì khác bị ảnh hưởng. Hệ thống vẫn chạy — nhưng velocity của team giảm dần đều, và không ai giải thích được tại sao.

---

## Boundary là gì và tại sao nó quan trọng

Boundary là đường phân chia trách nhiệm giữa các phần của hệ thống. Ở cấp độ module: `AppointmentModule` kết thúc ở đâu và `DoctorScheduleModule` bắt đầu ở đâu? Ở cấp độ class: `Patient` entity biết những gì và không biết những gì?

Boundary đúng nghĩa là: **khi một thứ thay đổi, chỉ những thứ liên quan đến nó mới cần thay đổi theo.** Boundary sai nghĩa là: thay đổi một thứ kéo theo một chuỗi thay đổi ở những nơi không ai ngờ tới.

---

## Dấu hiệu boundary đang sai

Có một test đơn giản: bạn vẽ vòng tròn quanh một module và hỏi, "nếu mình thay đổi thứ bên trong vòng tròn này, có gì bên ngoài bị ảnh hưởng không?"

Trong HMS, xét hai cách tổ chức `DoctorSchedule`:

```java
// ❌ Vấn đề: AppointmentService biết cấu trúc nội bộ của DoctorSchedule
@Service
public class AppointmentService {

    public void bookAppointment(BookingRequest request) {
        DoctorSchedule schedule = scheduleRepository.findById(request.getScheduleId())
            .orElseThrow();

        // AppointmentService đang quyết định logic của DoctorSchedule
        if (schedule.getCurrentPatients() >= schedule.getMaxPatients()) {
            throw new SlotUnavailableException();
        }
        schedule.setCurrentPatients(schedule.getCurrentPatients() + 1); // ❌ mutation từ bên ngoài

        scheduleRepository.save(schedule);
        // ... tạo appointment
    }
}
```

```java
// ✅ Tốt hơn: DoctorSchedule tự quản lý state của mình
public class DoctorSchedule {

    // Logic thuộc về entity — không exposed raw state ra ngoài
    public void reserveSlot() {
        if (!hasAvailableSlots()) {
            throw new SlotUnavailableException("Schedule " + id + " has no available slots");
        }
        this.currentPatients++;
    }

    public boolean hasAvailableSlots() {
        return currentPatients < maxPatients;
    }
}

@Service
public class AppointmentService {

    public void bookAppointment(BookingRequest request) {
        DoctorSchedule schedule = scheduleRepository.findById(request.getScheduleId())
            .orElseThrow();

        schedule.reserveSlot(); // AppointmentService chỉ nói "reserve" — không biết cách
        scheduleRepository.save(schedule);
        // ... tạo appointment
    }
}
```

Sự khác biệt: trong version thứ nhất, `AppointmentService` biết rằng `DoctorSchedule` có field `currentPatients` và `maxPatients`, và biết logic so sánh chúng. Nếu sau này bạn đổi logic — ví dụ thêm buffer slots cho emergency, hoặc đổi cách tính capacity — bạn phải sửa `AppointmentService`. Nhưng `AppointmentService` không liên quan đến capacity của schedule, nó chỉ cần đặt lịch hẹn.

Trong version thứ hai, `AppointmentService` không biết gì về cách `DoctorSchedule` quản lý slots. Nó chỉ biết "có thể reserve không" — và `DoctorSchedule` tự quyết định điều đó.

---

## Boundary sai ở cấp độ module

Vấn đề tương tự xảy ra ở cấp độ lớn hơn. Khi HMS phát triển, xuất hiện câu hỏi: "Ai chịu trách nhiệm cho việc tính available slots của một doctor?"

Nếu câu trả lời là "nhiều nơi cùng tính" — boundary đang sai. Thực tế trong nhiều hệ thống:

```
AppointmentModule:   gọi scheduleRepo.countByDoctorAndDate()
ReportModule:        gọi appointmentRepo.countByDoctorAndStatus()  
DashboardModule:     gọi cả hai rồi tự cộng trừ
```

Ba module, ba cách tính, ba kết quả có thể khác nhau khi data edge case xảy ra. Ai là source of truth?

Câu trả lời đúng: `DoctorScheduleModule` là owner của câu hỏi "doctor còn bao nhiêu slot." Ai cần biết thì hỏi module đó — không tự tính.

---

## Tại sao sai boundary lúc đầu khó nhận ra

Boundary sai thường xuất hiện dưới dạng "tiện thì làm luôn." Bạn đang trong `AppointmentService`, cần biết số slot còn lại, `scheduleRepository` đang inject sẵn — gọi luôn, nhanh gọn. Không ai reject PR vì lý do này.

Nhưng mỗi lần làm thế, bạn đang rỉ knowledge về DoctorSchedule sang AppointmentService. Sau mười lần như vậy, hai module đã entangled đến mức không thể tách ra mà không viết lại.

Dấu hiệu dễ nhận nhất: **nếu bạn không thể test một module mà không cần setup data cho module khác**, boundary đang bị vi phạm.

---

## Takeaway

Khi thiết kế boundary, hỏi một câu: *"Nếu module này cần thay đổi, ai cần biết?"* Nếu câu trả lời là "nhiều module khác nhau" — boundary đang quá rộng, hoặc đang ở sai chỗ.

---

*Bài tiếp theo: Domain logic không được biết database tồn tại*
