---
title: "Over-engineering — cái bẫy mà sinh viên hay sa vào nhất"
description: "Xây dựng hệ thống phức tạp cho bài toán đơn giản không phải là giỏi — đó là dấu hiệu bạn chưa hiểu vấn đề thật sự."
category: programming
pubDate: 2024-01-04
series: "Phần 1: Tư duy lập trình"
tags: ["mindset", "over-engineering", "YAGNI"]
---

Có một giai đoạn trong quá trình học lập trình mà hầu như ai cũng trải qua — giai đoạn bạn vừa học xong Design Patterns, đọc xong Clean Architecture, biết về microservices, event-driven systems, CQRS. Và rồi bạn nhìn vào mọi bài toán và thấy cơ hội để áp dụng tất cả những thứ đó.

Đây là giai đoạn nguy hiểm nhất trong career của một developer.

---

## Over-engineering trông như thế nào

Hãy tưởng tượng: bạn cần implement một feature gửi email thông báo cho bệnh nhân sau khi đặt lịch thành công. Requirement đơn giản — book xong, gửi email.

Người mới sẽ gọi thẳng email service trong appointment booking logic. Cách này đúng cho bài toán hiện tại.

Developer đang trong giai đoạn "vừa học xong nhiều thứ" sẽ thiết kế như sau: publish event `AppointmentBooked` lên Kafka, viết một consumer service riêng subscribe vào topic đó, consumer đó gọi notification service thông qua gRPC, notification service có một plugin system để support nhiều loại channel (email, SMS, push notification), mỗi channel được implement theo Strategy pattern, và toàn bộ config được load từ một distributed config server.

Kết quả: một feature "gửi email" tốn hai tuần để implement, cần ba service để deploy, và khi nó fail thì không ai biết fail ở đâu trong chuỗi đó.

---

## Tại sao over-engineering xảy ra

Nguyên nhân đầu tiên là **kiến thức mới không có context**. Khi bạn mới học về Kafka, bạn biết nó powerful. Nhưng bạn chưa có đủ kinh nghiệm để biết khi nào Kafka là cần thiết và khi nào nó là overkill. Thiếu context, bạn sẽ apply nó cho mọi thứ.

Nguyên nhân thứ hai là **muốn demonstrate knowledge**. Đây là điều mình thấy rất hay ở sinh viên khi làm đồ án hay side project — họ muốn code trông "xịn," muốn apply những pattern phức tạp vì nó chứng minh họ đã học được nhiều thứ. Nhưng production code không được đánh giá bởi độ phức tạp — nó được đánh giá bởi độ tin cậy và khả năng maintain.

Nguyên nhân thứ ba là **sợ tương lai**. "Biết đâu sau này cần scale lên triệu user." "Biết đâu sau này cần support nhiều loại notification." Những lo lắng này không sai về mặt kỹ thuật — nhưng nếu "sau này" đó không bao giờ đến, bạn đã đầu tư complexity vào một thứ không có ROI.

---

## Cái giá thật sự của over-engineering

Over-engineering không miễn phí. Nó có những cái giá rất cụ thể:

**Tốn thời gian build.** Thời gian đó có thể dùng để deliver thêm value cho user hoặc học những thứ thực sự cần thiết.

**Tốn thời gian maintain.** Mỗi abstraction layer, mỗi service, mỗi queue là một thứ bạn phải maintain, monitor, debug khi nó fail.

**Làm chậm onboarding.** Khi có thành viên mới tham gia project, họ phải hiểu toàn bộ complexity đó trước khi có thể contribute. Một codebase phức tạp không cần thiết là một codebase mà chỉ người viết nó mới có thể làm việc hiệu quả.

**Che khuất bug.** Bug trong một hệ thống đơn giản dễ tìm. Bug trong một distributed system với nhiều layer abstraction có thể mất nhiều ngày để trace.

---

## Nguyên tắc YAGNI — You Aren't Gonna Need It

Đây là một trong những nguyên tắc quan trọng nhất trong software engineering mà ít được dạy trong trường: **đừng implement thứ bạn chưa cần.**

Không phải "đừng nghĩ về tương lai." Mà là: đừng *implement* cho tương lai khi hiện tại chưa cần.

Cụ thể hơn: khi bạn đang thiết kế một solution, hãy hỏi bản thân — *requirement hiện tại có thật sự cần cái này không?* Nếu không, và nếu bạn chỉ thêm nó vì "biết đâu sau này cần" — đó là over-engineering.

Code tốt không phải code chuẩn bị cho mọi tình huống. Code tốt là code giải quyết bài toán hiện tại một cách clean và đủ flexible để adapt khi bài toán thay đổi.

---

## Làm sao biết mình đang over-engineer

Một vài câu hỏi để self-check:

- *Requirement hiện tại có thật sự cần cái này không?* Nếu bạn phải trả lời bằng "về sau có thể cần" — đó là dấu hiệu.

- *Nếu mình bỏ layer/service/pattern này đi, behavior có thay đổi không?* Nếu không — layer đó không earn its keep.

- *Mình có thể giải thích design này cho teammate trong 5 phút không?* Nếu không — nó phức tạp hơn bài toán cần.

- *Cái đơn giản nhất giải quyết được bài toán này là gì?* Start từ đó, rồi thêm complexity khi có bằng chứng cần thiết.

---

## Điểm cân bằng

Over-engineering không có nghĩa là bạn không được thiết kế tốt. Có một sự khác biệt quan trọng giữa "thiết kế tốt, dễ thay đổi khi cần" và "thiết kế phức tạp vì tưởng tượng ra những thứ có thể cần."

Ví dụ: viết một Notification service với interface rõ ràng và implementation có thể swap — đó là thiết kế tốt. Nhưng implement sẵn cả Kafka + gRPC + plugin system khi bạn chỉ cần gửi email — đó là over-engineering.

Design cho present. Leave room cho future. Đừng build cho future khi present chưa cần.

---

## Takeaway

Lần tới khi bạn thấy mình đang thêm một layer, một pattern, một service mới — hãy dừng lại và hỏi: *"Requirement hiện tại có thật sự cần cái này không? Hay mình đang build cho một tương lai mà có thể không bao giờ đến?"*

Nếu câu trả lời là không chắc — start simple. Bạn luôn có thể thêm complexity sau khi có bằng chứng cần thiết. Bạn không thể lấy lại thời gian đã bỏ vào complexity không cần thiết.

---

*Bài tiếp theo: Under-engineering — cái bẫy ít ai nói đến.*
