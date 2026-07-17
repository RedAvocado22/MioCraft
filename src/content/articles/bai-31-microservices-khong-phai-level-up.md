---
title: "Microservices không phải level up tự động từ Monolith"
description: "Microservices giải quyết vấn đề của scale và team autonomy — không phải vấn đề của code xấu. Chuyển sang microservices khi chưa sẵn sàng là tự làm khổ mình."
category: architecture
pubDate: 2024-01-31
series: "Phần 3: Kiến trúc phần mềm"
tags: ["architecture", "microservices", "monolith"]
---

Có một misconception rất phổ biến trong giới developer trẻ: monolith là "level 1", microservices là "level 2." Khi project đủ lớn hoặc bạn đủ giỏi, bạn "lên đời" sang microservices.

Đó không phải cách nó hoạt động.

Netflix, Amazon, Uber dùng microservices vì họ có hàng trăm team làm việc độc lập, deploy hàng trăm service mỗi ngày, ở quy mô mà một monolith không thể chịu được về mặt tổ chức lẫn kỹ thuật. Đó là những problem mà bạn — với một team ba đến năm người xây HMS — chưa gặp và có thể sẽ không bao giờ gặp ở quy mô đó.

Câu hỏi không phải "monolith hay microservices?" Câu hỏi là "vấn đề mình đang giải quyết là gì, và giải pháp nào phù hợp với vấn đề đó?"

---

## Cái microservices thực sự giải quyết

Microservices giải quyết **organizational và deployment scaling** — không phải technical scaling theo nghĩa performance.

Khi bạn có một monolith và mười team cùng làm việc trên nó, mỗi deploy đòi hỏi coordination giữa mười team. Một team muốn deploy feature mới phải đợi team khác không có conflict trong cùng release window. Một bug nhỏ của team A chặn deploy của team B. Và khi một phần của system cần scale — ví dụ chỉ module thanh toán cần thêm instance — bạn phải scale toàn bộ monolith.

Microservices giải quyết đúng vấn đề đó: mỗi service có team riêng, deploy pipeline riêng, scale độc lập. Đó là lý do nó worth it khi có đủ scale.

Nhưng nó đi kèm với rất nhiều complexity mà monolith không có.

---

## Chi phí thật sự của microservices

```
Monolith:
  Patient muốn đặt lịch hẹn
  → AppointmentService gọi DoctorScheduleService
  → Method call trong cùng JVM
  → Latency: microseconds
  → Nếu lỗi: throw exception, transaction rollback
  → Debug: single stack trace

Microservices:
  Patient muốn đặt lịch hẹn
  → AppointmentService gọi HTTP đến ScheduleService
  → ScheduleService gọi HTTP đến InsuranceService
  → Latency: milliseconds (mỗi hop cộng thêm)
  → Nếu ScheduleService down: circuit breaker, fallback, retry?
  → Nếu transaction spanning hai service: Saga pattern, compensation
  → Debug: distributed tracing, correlation ID, log aggregation
```

Mỗi network call là một điểm failure mới. Mỗi service là một thing bạn phải deploy, monitor, scale, và maintain. Distributed transaction là một trong những vấn đề khó nhất trong computer science — và microservices tạo ra rất nhiều distributed transaction.

Nhìn vào HMS: `bookAppointment` cần atomic: tạo Appointment, decrement slot trong DoctorSchedule, tạo payment record. Trong monolith, đây là một database transaction — rollback nếu bất kỳ bước nào fail. Trong microservices với ba service riêng biệt, bạn cần implement Saga pattern với compensation logic. Đó là nhiều tuần code chỉ để giữ data consistent.

---

## Monolith không phải là thứ cần xấu hổ

Shopify — xử lý hàng tỷ dollar transaction mỗi năm — dùng monolith Ruby on Rails cho đến gần đây. Stack Overflow phục vụ hàng triệu request mỗi ngày với vài chục server và một monolith SQL Server. Basecamp là SaaS lớn, profitable, và vẫn là monolith.

Monolith không scale được là myth. Monolith scale bằng cách thêm instance, dùng load balancer, optimize database. Nó khác với microservices về *cách* scale và *ai* scale — nhưng không phải "không thể scale."

---

## Modular Monolith — con đường trung gian

Có một lựa chọn thứ ba mà ít được nhắc đến: **Modular Monolith** — monolith với boundary rõ ràng giữa các module bên trong.

Đây chính xác là gì HMS nên hướng đến:

```
hms-monolith/
  ├── appointment-module/
  │   ├── domain/          ← pure Java, no framework
  │   ├── application/     ← use cases
  │   ├── infrastructure/  ← JPA, Redis, etc.
  │   └── api/             ← REST controllers
  ├── schedule-module/
  ├── insurance-module/
  ├── notification-module/
  └── shared-kernel/       ← shared domain primitives
```

Các module communicate qua defined interface, không phải direct class reference. `AppointmentModule` không import class nào từ `InsuranceModule` trực tiếp — nó chỉ biết về interface `InsurancePort`. Trong test, bạn có thể mock interface đó.

Cái hay: nếu ngày nào đó cần tách ra thành microservices, boundary đã rõ ràng. `InsurancePort` trở thành HTTP call thay vì in-process call. Migration là thật sự feasible, không phải "rewrite toàn bộ."

---

## Takeaway

Câu hỏi đúng không phải là "khi nào thì chuyển sang microservices." Câu hỏi đúng là: *"Vấn đề của mình — organizational complexity, deployment independence, hay operational scaling — có phải là vấn đề microservices được thiết kế để giải quyết không?"* Nếu chưa — monolith với boundary tốt là đủ, và sẽ ít đau đớn hơn nhiều.

---

*Bài tiếp theo: Kiến trúc thường chết vì con người, không phải vì code*
