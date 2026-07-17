---
title: "Functional vs Non-functional Requirements — hiểu sai là thiết kế sai"
description: "Functional: hệ thống làm gì. Non-functional: hệ thống hoạt động tốt thế nào. Bỏ qua non-functional requirements là lý do nhiều hệ thống sập khi có người dùng thật."
category: system-design
pubDate: 2024-03-08
series: "Phần 8: System Design"
tags: ["system-design", "requirements", "scalability"]
---

Hãy tưởng tượng bạn nhận được một requirement: *"Bệnh nhân có thể đặt lịch khám."*

Bạn đọc xong, mở IDE, bắt đầu tạo `AppointmentController`. Đó là phản xạ tự nhiên của dev — nhìn thấy requirement, nghĩ ngay đến implementation.

Nhưng requirement đó mới nói với bạn *cái gì* hệ thống phải làm. Nó chưa nói gì về *hệ thống phải làm nó như thế nào, nhanh đến đâu, chịu được bao nhiêu người, và fail ra sao khi có lỗi.*

---

## Hai loại requirements — và tại sao cả hai đều quan trọng

**Functional requirements** mô tả hành vi của hệ thống: những tính năng, những thao tác, những luồng nghiệp vụ. Bệnh nhân đặt lịch. Doctor xem lịch của mình. Admin cancel appointment. Đây là những thứ bạn biết rõ từ đầu, vì chúng thường được viết ra trong requirements doc hoặc user story.

**Non-functional requirements** mô tả *chất lượng* của hệ thống: nhanh đến đâu, chịu được bao nhiêu load, available bao nhiêu phần trăm thời gian, bảo mật ở mức độ nào, có scale được không. Đây là những thứ thường không được viết ra — và đó chính là lý do chúng nguy hiểm.

Khi chỉ nghĩ đến functional requirements, bạn xây một hệ thống có đủ tính năng nhưng có thể collapse ngay khi ra production. Khi cân bằng cả hai, bạn xây được hệ thống thực sự sống được.

---

## NFR thực tế trông như thế nào

Lấy tính năng đặt lịch của HMS làm ví dụ. Functional requirement đơn giản: bệnh nhân chọn bác sĩ, chọn ngày giờ, xác nhận. Nhưng non-functional requirements mới là thứ quyết định kiến trúc:

**Performance:** API response phải dưới 500ms ở percentile 95. Điều này có nghĩa là bạn không thể load toàn bộ schedule của một doctor rồi filter trong application — phải push logic xuống database hoặc cache.

**Concurrency:** Hai bệnh nhân có thể cùng lúc cố đặt slot cuối cùng của cùng một doctor. Ai thắng? Làm sao đảm bảo không double-book? Đây là lý do Redis Lua script tồn tại trong HMS — không phải vì tính năng đặt lịch phức tạp, mà vì NFR về data consistency dưới concurrent load yêu cầu atomic operation.

**Availability:** Nếu Redis down thì system có tiếp tục nhận booking không? Degraded gracefully hay hard fail? Câu trả lời không phải là kỹ thuật — đó là quyết định nghiệp vụ. Nhưng nếu bạn không hỏi câu này trước khi code, bạn sẽ không có câu trả lời khi production cần nó.

**Auditability:** Mọi thay đổi trạng thái của appointment có cần được log không? Nếu có, log ở đâu — database, file, hay event stream? Đây không phải tính năng — không user nào "dùng" audit log trực tiếp. Nhưng khi có tranh chấp hoặc compliance audit, đó là thứ quyết định hệ thống của bạn có thể defend được hay không.

---

## Tại sao NFR thường bị bỏ qua và hậu quả là gì

NFR không nằm trong ticket. Product manager không viết "system phải respond dưới 500ms" vào sprint backlog. Bởi vì họ assume bạn tự biết — hoặc vì họ không biết đó là thứ cần specify.

Kết quả: dev implement functional requirement xong, demo chạy ngon, merge vào main. Ba tháng sau, traffic tăng, hệ thống chậm dần. Lúc đó mới đi optimize thì đã muộn — kiến trúc đã được lock in, refactor sẽ tốn nhiều thứ hơn.

Đây là lý do khi người có kinh nghiệm nhận một requirement mới, câu hỏi đầu tiên không phải "mình implement cái này như thế nào?" — mà là "những ràng buộc phi chức năng của tính năng này là gì?"

---

## Những NFR quan trọng nhất cần biết

Không phải tất cả NFR đều quan trọng như nhau — tùy hệ thống. Nhưng có một số loại bạn sẽ gặp hầu như ở mọi backend system:

**Latency & Throughput:** Bao lâu mỗi request phải xong? Bao nhiêu request mỗi giây hệ thống cần chịu? Hai con số này ảnh hưởng trực tiếp đến caching strategy, database indexing, và có cần queue hay không.

**Consistency:** Khi data được write, bao lâu sau thì read thấy được? Luôn luôn ngay lập tức (strong consistency) hay có thể chậm một chút (eventual consistency)? Strong consistency đơn giản hơn để reason about nhưng hard hơn để scale.

**Availability:** Hệ thống cần uptime bao nhiêu? 99%? 99.9%? 99.99%? Mỗi con số đó yêu cầu một level của redundancy và failover khác nhau — và chi phí khác nhau.

**Durability:** Nếu server crash ngay lúc đang write, data có bị mất không? Mức độ durability cần thiết ảnh hưởng đến cách bạn config database và cách bạn handle transaction.

---

## Cách áp dụng vào HMS ngay bây giờ

Bạn không cần document đầy đủ tất cả NFR cho mọi tính năng — project của bạn không phải enterprise. Nhưng với mỗi tính năng quan trọng, hãy tự hỏi ba câu:

1. *Feature này sẽ được dùng bao nhiêu lần mỗi giây lúc peak?* — con số đó ảnh hưởng đến bạn cần cache không, index gì.
2. *Nếu feature này chậm hoặc fail, impact đến user là gì?* — điều đó quyết định priority của performance optimization.
3. *Data của feature này có cần consistent tuyệt đối không, hay eventual là đủ?* — câu trả lời đó quyết định bạn có cần distributed lock hay không.

---

## Takeaway

Trước khi viết dòng code đầu tiên của một tính năng mới, viết ra ba ràng buộc phi chức năng của nó. Không cần formal — một ghi chú trong comment hoặc trong task description là đủ. Thói quen đó thay đổi cách bạn nghĩ về implementation từ "nó có chạy không" sang "nó có chịu được không."

---

*Bài tiếp theo: Monolith vs Microservices — chọn sai kiến trúc là đốt cả năm*
