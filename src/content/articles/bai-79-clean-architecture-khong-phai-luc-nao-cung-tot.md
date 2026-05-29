---
title: "Clean Architecture không phải lúc nào cũng tốt"
description: "Clean Architecture thêm nhiều layer và abstraction. Với CRUD app đơn giản — đây là over-engineering. Với hệ thống phức tạp có nhiều business rule — đây là đầu tư đúng đắn."
category: system-design
pubDate: 2024-03-20
series: "Phần 9: Không phải lúc nào cũng đúng"
tags: ["tech-myths", "clean-architecture", "trade-off"]
---

Sau khi đọc xong Robert Martin hay một series trên Medium về Clean Architecture, có một cảm giác rất thực: *tao phải refactor lại toàn bộ project.* Use cases, entities, ports, adapters, dependency inversion ở mọi layer — tất cả.

Cảm giác đó không sai. Nhưng hành động từ cảm giác đó không phải lúc nào cũng đúng.

---

## Clean Architecture giải quyết vấn đề gì

Clean Architecture — và các biến thể như Hexagonal (Ports & Adapters), Onion Architecture — được thiết kế để giải quyết một vấn đề cụ thể: **business logic bị coupled vào infrastructure.**

Khi `AppointmentService` import trực tiếp `JpaRepository`, gọi `RedisTemplate`, và parse `HttpServletRequest` trong cùng một method — thì business logic của mày bị trói vào Spring, JPA, và Redis. Muốn test logic đặt lịch thì phải spin up database. Muốn swap Redis ra thì phải đụng vào business code.

Clean Architecture nói: business logic nên không biết database, HTTP, hay message broker tồn tại. Chỉ biết interface.

Đây là vấn đề thật. Nhưng nó thật ở quy mô và tốc độ thay đổi nhất định.

---

## Chi phí thật sự của Clean Architecture

Implement đúng Clean Architecture cho một feature đặt lịch trong HMS có nghĩa là mày cần:

- `BookAppointmentUseCase` interface + `BookAppointmentUseCaseImpl`
- `AppointmentRepository` interface ở domain layer + `AppointmentJpaRepository` adapter
- `NotificationPort` interface + `KeycloakNotificationAdapter`
- `AppointmentMapper` để convert giữa domain entity và JPA entity

Với mỗi feature mới, số lượng file tăng lên theo kiểu đó. Với team hai người và deadline đồ án, đây là overhead thật sự — không phải lý thuyết.

Và quan trọng hơn: overhead đó có payoff khi mày thực sự cần swap implementation. Nhưng trong 99% project, mày không swap từ JPA sang Mongo, không swap từ Keycloak sang Auth0. Mày biết ngay từ đầu stack của mình là gì và nó sẽ không thay đổi trong vòng đời của project.

---

## Gradient, không phải binary

Điều mà nhiều người miss là Clean Architecture không phải on/off switch. Nó là một spectrum, và mày chọn điểm nào trên spectrum đó tùy vào nhu cầu thực tế.

**Minimal structure** — Controller gọi thẳng Service, Service gọi thẳng Repository. Đủ cho CRUD đơn giản, script nội bộ, admin tool. Không scale về complexity.

**Practical layering** — Controller → Service → Repository, với business logic rõ ràng trong Service, domain methods trên Entity. Đây là điểm sweet spot cho hầu hết project vừa nhỏ. HMS đang ở đây và nó đúng.

**Full Clean Architecture** — Use cases, ports, adapters, domain isolation hoàn toàn. Justified khi business logic complex thực sự, khi cần test business logic hoàn toàn in-memory, khi infrastructure có khả năng thay đổi cao.

Vấn đề không phải "có nên dùng Clean Architecture không" mà là "mày đang ở đâu trên spectrum đó và nó có phù hợp với complexity thực tế của project không."

---

## Dấu hiệu mày đang over-architect

Mày implement một abstraction layer và không thể đặt tên cho vấn đề cụ thể nó giải quyết.

Mày viết một `UseCase` class chỉ để delegate sang `Service` mà không có business logic gì trong `UseCase` đó.

Mày có `DoctorRepository` interface với một implementation duy nhất là `DoctorJpaRepository` và không có kế hoạch nào để thêm implementation thứ hai.

Những dấu hiệu đó không có nghĩa là mày sai hoàn toàn — chúng có nghĩa là abstraction đang chạy trước nhu cầu.

---

## Điều thực sự quan trọng

Dù mày chọn architecture nào, một thứ không thay đổi: **business logic không được lẫn với infrastructure concern trong cùng một method.**

`DoctorScheduleService` không được vừa tính toán available slots, vừa format response, vừa ghi log, vừa publish event — tất cả trong một method 80 dòng. Đó không phải vấn đề của layer nào, đó là vấn đề của single responsibility cơ bản.

Clean Architecture hay không, principle này vẫn đúng. Và nếu mày giữ được điều đó, mày đã ở 80% của điểm đến rồi.

---

## Takeaway

Trước khi refactor project sang Clean Architecture, hỏi: *"Vấn đề cụ thể tao đang gặp là gì — test khó, swap infrastructure, hay business logic đang bị buried?"* Câu trả lời đó sẽ cho mày biết bao nhiêu architecture là đủ.

---

*Bài tiếp theo: Queue không phải lúc nào cũng làm hệ thống ổn định hơn*
