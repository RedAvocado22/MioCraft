---
title: "CAP Theorem — ba thứ không thể có cùng lúc"
description: "Consistency, Availability, Partition Tolerance — bạn chỉ có thể chọn hai. Hiểu CAP không phải để thuộc lòng — mà để đưa ra quyết định đúng khi thiết kế distributed system."
category: system-design
pubDate: 2024-03-15
series: "Phần 8: System Design"
tags: ["system-design", "CAP-theorem", "distributed-systems"]
---

Có một cuộc tranh luận cũ trong giới system design: *"Dùng MySQL hay MongoDB cho hệ thống này?"*

Câu trả lời đúng hiếm khi là về syntax hay performance benchmark. Câu trả lời đúng thường là: *"Hệ thống này có thể chấp nhận serve data cũ không? Và nó có thể dừng hoạt động khi có network problem không?"*

Đây là cốt lõi của CAP Theorem.

---

## Ba thuộc tính của distributed system

CAP Theorem nói rằng trong một distributed system — hệ thống có nhiều node giao tiếp qua network — mày chỉ có thể đảm bảo được hai trong ba thuộc tính sau:

**Consistency (C):** Mọi read đều trả về kết quả của write gần nhất, hoặc trả về lỗi. Nói cách khác: tất cả node đều có cùng một view về data tại mọi thời điểm. Sau khi Doctor A update lịch làm việc, bất kỳ ai query đều thấy lịch mới — không ai thấy lịch cũ.

**Availability (A):** Mọi request đều nhận được response — không nhất thiết là data mới nhất, nhưng phải là response, không phải lỗi. Hệ thống luôn phản hồi, kể cả khi một số node đang gặp vấn đề.

**Partition Tolerance (P):** Hệ thống tiếp tục hoạt động kể cả khi network partition xảy ra — tức là một số node không thể giao tiếp với nhau do đứt mạng hoặc network delay nghiêm trọng.

---

## Tại sao chỉ có thể chọn hai

Network partition không phải khả năng lý thuyết — nó là thực tế. Bất kỳ hệ thống nào có nhiều server thì sớm muộn sẽ có lúc hai server không nói chuyện được với nhau: network cable hỏng, switch bị lỗi, datacenter bị ngắt kết nối. Vì vậy, **P là bắt buộc**. Mày không thể chọn "tao sẽ không có partition" — mày chỉ chọn cách hệ thống react khi partition xảy ra.

Điều đó có nghĩa lựa chọn thực sự là: **khi có network partition, mày hy sinh C hay A?**

**CP — Consistency over Availability:** Khi partition xảy ra, hệ thống từ chối serve request thay vì risk trả về data không nhất quán. "Tao không biết câu trả lời chính xác, nên tao sẽ không trả lời." Banking system thuộc loại này — thà từ chối transaction còn hơn risk double-spend.

**AP — Availability over Consistency:** Khi partition xảy ra, hệ thống vẫn serve request nhưng có thể trả về data cũ hoặc data khác nhau từ các node khác nhau. "Tao sẽ trả lời, nhưng có thể không phải thông tin mới nhất." DNS, social media feed, shopping cart thuộc loại này — thà show data hơi cũ còn hơn bị lỗi.

---

## CAP trong thực tế — không phải binary

Lý thuyết CAP thường bị misrepresent như một lựa chọn cứng nhắc: MySQL là CP, Cassandra là AP. Thực tế phức tạp hơn.

Hầu hết database hiện đại cho phép mày **configure** behavior — và behavior đó có thể khác nhau giữa các operation, thậm chí là giữa các request.

MySQL với replication: nếu mày đọc từ primary, mày có strong consistency. Nếu mày đọc từ replica, mày có eventual consistency — replica có thể lag vài milliseconds so với primary. Đây là lý do tại sao trong nhiều hệ thống, write và critical read đi đến primary, còn non-critical read (analytics, reports) đi đến replica.

Redis Cluster: khi có network partition, Redis có thể lose writes để đảm bảo cluster vẫn available. Nếu mày dùng Redis cho slot booking — như HMS đang làm — mày cần biết rằng trong partition scenario hiếm gặp, một số write có thể bị mất.

---

## PACELC — mô hình thực tế hơn

CAP chỉ nói về behavior khi có partition. Nhưng partition là exception case — hầu hết thời gian network bình thường. Năm 2012, Daniel Abadi đề xuất PACELC, extend CAP:

*Nếu có Partition (P): chọn Availability (A) hay Consistency (C). Còn lại khi bình thường (Else): chọn Latency (L) hay Consistency (C).*

Đây là trade-off quan trọng hơn trong ngày thường: mày có muốn mọi write phải đồng bộ đến tất cả replica trước khi return (high consistency, high latency) hay return ngay sau khi write đến primary (low latency, eventual consistency)?

Trong HMS, khi bệnh nhân tạo appointment, mày muốn low latency hơn hay absolute consistency? Nếu primary return success nhưng replica chưa sync và server primary chết ngay lúc đó — appointment đó có bị mất không? Đây là câu hỏi mà database configuration của mày trả lời.

---

## Ứng dụng vào HMS: quyết định consistency nằm ở đâu

Không phải mọi data trong HMS đều cần consistency level như nhau:

**Appointment booking** — cần strong consistency. Không thể có hai người cùng giữ một slot. Redis Lua script của mày đang handle điều này ở tầng application. Ở tầng database, appointment write phải đến primary.

**Doctor schedule read** — acceptable có slight lag. Nếu doctor vừa update lịch và bệnh nhân thấy lịch cũ trong 100ms, không phải vấn đề nghiêm trọng. Read có thể đến replica.

**Patient medical record** — depends on context. Read cho doctor xem trong khi khám cần up-to-date. Read cho báo cáo cuối tháng có thể đến replica.

**Notification delivery** — eventual consistency là fine. Email không nhất thiết phải gửi trong millisecond, nhưng phải được gửi cuối cùng (at-least-once delivery).

---

## Đừng học CAP để thuộc định lý — học nó để ra quyết định

CAP Theorem không phải thứ mày đọc thuộc để trả lời phỏng vấn. Nó là mental model để ra quyết định thiết kế:

Khi product manager hỏi "tại sao user đôi khi thấy data cũ?" — câu trả lời không phải "vì bug" mà là "vì chúng ta đã trade consistency để lấy performance ở chỗ này."

Khi xảy ra incident và database replica lag 5 giây — câu hỏi đúng không phải "làm sao fix nhanh?" mà là "business chúng ta có accept được 5 giây eventual consistency không? Nếu không, chúng ta cần thay đổi read routing."

---

## Takeaway

Lần tới khi chọn database, caching strategy, hoặc replication config, hãy hỏi: *"Với data này, nếu tao phải chọn giữa trả về data cũ và từ chối trả lời, tao chọn gì?"* — câu trả lời đó define consistency requirement của mày, và từ đó define architecture đúng.

---

*Bài tiếp theo: Microservices không phải phép màu giúp mày scale*
