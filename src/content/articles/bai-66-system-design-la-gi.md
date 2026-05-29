---
title: "System Design là gì — và tại sao code giỏi vẫn làm hệ thống sập"
description: "Code đúng chưa đủ để hệ thống chạy tốt ở scale lớn. System design là khả năng thiết kế hệ thống đáp ứng được non-functional requirements: scale, availability, latency."
category: system-design
pubDate: 2024-03-07
series: "Phần 8: System Design"
tags: ["system-design", "scalability", "architecture"]
---

Có một câu hỏi phỏng vấn mà rất nhiều dev senior hay hỏi junior: *"Thiết kế một hệ thống đặt lịch khám bệnh — mày sẽ bắt đầu từ đâu?"*

Câu trả lời phổ biến nhất từ sinh viên: *"Tao sẽ tạo bảng `Appointment`, bảng `Doctor`, bảng `Patient`..."*

Đó không phải câu trả lời sai. Đó là câu trả lời của người đang nghĩ ở tầng sai.

---

## Code giỏi không đủ

Giả sử mày viết code rất clean. Service tách rõ ràng, query được optimize, exception được handle đúng. Rồi hệ thống lên production. Tuần đầu mọi thứ ổn. Tuần thứ hai, traffic tăng gấp 3. Hệ thống bắt đầu chậm. Tuần thứ ba, có hai người dùng cùng đặt một slot của bác sĩ — cả hai nhận confirmation, nhưng chỉ có một slot. Tuần thứ tư, database server đột ngột bị tắt để maintenance — toàn bộ hệ thống down theo.

Không có dòng code nào sai trong các scenario này. Vấn đề nằm ở tầng cao hơn: **thiết kế hệ thống**.

System Design là câu hỏi về cách các thành phần trong hệ thống được tổ chức, giao tiếp, và phối hợp với nhau để đáp ứng được những yêu cầu mà code đơn thuần không giải quyết được — tải cao, lỗi phần cứng, concurrency, latency, và data consistency.

---

## Hai tầng mà mọi hệ thống đều có

Hãy nghĩ về HMS của mày. Ở tầng thứ nhất là code: Spring Boot service, JPA repository, REST controller. Đây là thứ mày đang xây dựng mỗi ngày — logic, validation, transformation.

Ở tầng thứ hai là hệ thống: bao nhiêu instance của service đang chạy? Chúng giao tiếp với nhau qua gì? Database ở đâu, có replica không? Nếu Redis chết thì hệ thống behave như thế nào? Notification được gửi đồng bộ hay bất đồng bộ? Nếu service gửi mail down trong 10 phút thì appointment có bị rollback không?

Tầng một quyết định hệ thống có đúng không. Tầng hai quyết định hệ thống có **sống sót** không.

Phần lớn sinh viên chỉ được đào tạo về tầng một. Phần 8 này sẽ mở tầng hai ra.

---

## Những câu hỏi System Design thực sự cần trả lời

Khi thiết kế một tính năng, senior sẽ không chỉ hỏi "logic này đúng chưa?" — họ còn hỏi:

**Về tải:** Hệ thống cần chịu bao nhiêu request mỗi giây? Lúc peak là khi nào — sáng sớm khi bệnh nhân đặt lịch ồ ạt, hay rải đều cả ngày?

**Về lỗi:** Nếu một component chết, hệ thống còn chạy được không? Hay nó kéo theo cả chuỗi? Khi recover, data có bị mất không?

**Về consistency:** Nếu hai người dùng cùng thao tác trên cùng một resource, hệ thống xử lý thế nào? Ai thắng? Ai được thông báo?

**Về latency:** Response 200ms có chấp nhận được không? 2 giây thì sao? Những operation nào có thể làm async để không block user?

Những câu hỏi này không có câu trả lời "đúng" hay "sai" theo nghĩa tuyệt đối. Chúng có **trade-off** — mày tăng availability thì phải hi sinh consistency, mày tăng throughput thì phải tăng complexity. System Design là kỹ năng nhìn thấy những trade-off đó và chọn cái phù hợp với context.

---

## Tại sao sinh viên thường bỏ qua tầng này

Vì trường không dạy. Và vì trong project sinh viên, hệ thống chạy trên máy local với một mình mày dùng — không có concurrent user, không có hardware failure, không có traffic spike. Những vấn đề mà System Design giải quyết chỉ xuất hiện ở scale nhất định.

Nhưng đây là cái bẫy: đến khi mày thật sự gặp những vấn đề đó, cost để fix architecture đã cao hơn rất nhiều so với cost để thiết kế đúng từ đầu.

Phần 8 sẽ đi qua những building block cơ bản nhất: từ functional vs non-functional requirements, monolith vs microservices, API design, load balancer, message queue, rate limiting, circuit breaker, đến CAP theorem. Không phải để mày trở thành system architect ngay lập tức — mà để mày bắt đầu nghĩ ở đúng tầng khi thiết kế.

---

## Takeaway

Lần tới khi mày bắt đầu một feature mới, trước khi tạo entity hay viết service, hãy hỏi: *"Nếu feature này có 1000 người dùng cùng lúc, điều gì sẽ break đầu tiên?"* — câu hỏi đó là entry point của System Design thinking.

---

*Bài tiếp theo: Functional vs Non-functional Requirements — hiểu sai là thiết kế sai*
