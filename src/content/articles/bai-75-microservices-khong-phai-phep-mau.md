---
title: "Microservices không phải phép màu giúp mày scale"
description: "Microservices giải quyết vấn đề team autonomy và deployment independence — không phải vấn đề performance. Scale nằm ở database, caching, và infrastructure — không phải ở việc chia service."
category: system-design
pubDate: 2024-03-16
series: "Phần 9: Không phải lúc nào cũng đúng"
tags: ["tech-myths", "microservices", "scalability"]
---

Có một câu chuyện khá phổ biến trong giới dev: một startup gặp vấn đề performance, team quyết định "chuyển sang microservices", rồi sau 6 tháng hệ thống vẫn chậm — nhưng giờ có thêm một đống vấn đề mới mà trước không có.

Microservices không làm hệ thống scale tốt hơn. Microservices giúp mày **scale từng phần độc lập** — nhưng chỉ khi mày đã hiểu rõ mình muốn scale cái gì và tại sao.

---

## Cái mà mọi người nghe được vs. cái thực sự đúng

Khi đọc về Netflix hay Amazon dùng microservices để handle hàng triệu request mỗi giây, não mày tự động rút ra kết luận: *microservices = scale được.*

Sai. Netflix không scale được vì họ dùng microservices. Họ dùng microservices vì họ đã scale đến mức mà một monolith không còn phù hợp nữa — về mặt tổ chức team, về mặt deploy cycle, về mặt isolation failure. Scaling là bài toán họ đã giải xong bằng cách khác từ trước.

Microservices giải quyết những vấn đề cụ thể:

- **Team scale:** Khi 50 engineer cùng commit vào một repo, merge conflict và coordination overhead trở thành bottleneck thật sự
- **Deploy independence:** Khi mày muốn deploy `AppointmentService` mà không phải test lại toàn bộ hệ thống
- **Failure isolation:** Khi `NotificationService` chết thì booking vẫn phải chạy được

Đây không phải "scale performance". Đây là "scale tổ chức".

---

## Cái giá mà không ai nói

Với HMS có hai developer, một monolith well-structured sẽ outperform một microservices setup về mọi mặt — development speed, debuggability, operational cost.

Hãy nhìn vào một flow đơn giản: bệnh nhân book lịch, doctor nhận notification.

Trong monolith:

```java
// AppointmentService.java
@Transactional
public AppointmentResponse bookAppointment(BookingRequest request) {
    DoctorSchedule schedule = scheduleRepository.findAndLockSlot(
        request.getDoctorId(), request.getDate(), request.getSlot()
    );
    
    Appointment appointment = appointmentRepository.save(
        Appointment.from(request, schedule)
    );
    
    // Event publish — NotificationService xử lý async sau transaction commit
    eventPublisher.publishEvent(new AppointmentBookedEvent(appointment));
    
    return appointmentMapper.toResponse(appointment);
}
```

Một transaction. Một database. Nếu fail thì rollback toàn bộ. Debug thì trace stack ngay trong IDE. Deploy thì một lần.

Trong microservices, cùng flow đó mày cần xử lý:
- Service discovery (AppointmentService tìm NotificationService ở đâu?)
- Network call có thể fail (timeout, connection refused)
- Distributed transaction — nếu save appointment thành công nhưng notification service down thì sao?
- Message broker để đảm bảo notification eventually delivered
- Observability — trace một request qua 3 services mà không có distributed tracing thì thôi xong

Mỗi thứ đó là một layer complexity mới, một class of bug mới, và một thứ cần maintain thêm.

---

## Khi nào microservices thực sự có nghĩa

Microservices có nghĩa khi:

**Vấn đề là tổ chức, không phải performance.** Team mày quá lớn để làm việc trên một codebase mà không giẫm lên nhau. Khi đó, boundary giữa services cũng là boundary giữa team — và đó là thứ microservices thực sự cho mày.

**Workload genuinely khác nhau.** Trong HMS, nếu module AI triage cần GPU và memory hoàn toàn khác với module booking thông thường — khi đó tách ra có lý. Còn nếu tất cả đều là CRUD trên MySQL thì tách ra chỉ để tách.

**Failure domain cần isolation thật sự.** Nếu `ReportingService` đang chạy một báo cáo nặng mà mày cần đảm bảo nó không ảnh hưởng đến booking — đó là lý do kỹ thuật thật sự.

---

## Vậy monolith thì scale thế nào?

Cách đúng là horizontal scaling: chạy nhiều instance của monolith đằng sau load balancer, stateless session (JWT thay vì server-side session), database connection pool tuning, và cache đặt đúng chỗ.

Stack này handle được hàng chục nghìn concurrent user thoải mái — và 99% startup không bao giờ vượt qua ngưỡng đó trước khi gặp vấn đề khác to hơn.

---

## Takeaway

Trước khi nghĩ đến microservices, hãy hỏi: *team tao có bao nhiêu người, và bottleneck thực sự của tao là gì?* Nếu câu trả lời là "tao code một mình và app chậm" — microservices không phải thứ mày cần.

---

*Bài tiếp theo: NoSQL không scale tốt hơn SQL — đó là cú lừa hoàn hảo*
