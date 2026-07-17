---
title: "Scaling sớm không phải lúc nào cũng là quyết định đúng"
description: "Premature optimization là evil — premature scaling còn tệ hơn. Phần lớn startup thất bại vì không có user, không phải vì không scale được. Build for now, design for scale."
category: system-design
pubDate: 2024-03-22
series: "Phần 9: Không phải lúc nào cũng đúng"
tags: ["tech-myths", "scalability", "startup"]
---

Premature optimization is the root of all evil — Donald Knuth nói câu đó từ 1974, và nó vẫn đúng đến hôm nay, có lẽ còn đúng hơn vì giờ chúng ta có nhiều tool để optimize hơn và nhiều cơ hội để dùng sai hơn.

Scaling sớm là một dạng premature optimization — nhưng nguy hiểm hơn ở chỗ nó ăn không chỉ performance mà còn ăn luôn development speed, maintainability, và đôi khi cả product direction.

---

## Cái giá của scaling trước khi cần

Khi bạn design hệ thống để handle 1 triệu user từ ngày đầu, bạn đang đưa ra các quyết định cho một context mà bạn chưa có đủ thông tin để quyết định đúng.

Bạn sẽ shard database theo một dimension — nhưng bạn chưa biết access pattern thực tế là gì. Bạn implement distributed cache — nhưng bạn chưa biết thứ gì thực sự được đọc nhiều. Bạn tách microservices — nhưng bạn chưa biết boundary thực sự của business domain là gì.

Kết quả: bạn spend thời gian và complexity budget vào những thứ chưa cần — trong khi feature thực sự mà user cần thì chưa có.

Và điều tệ nhất: khi business thay đổi hướng (điều luôn xảy ra), cái scaling infrastructure bạn đã build có thể là trở ngại thay vì asset.

---

## Scale đúng thời điểm không phải scale muộn — là scale đúng lúc

Đây không phải lời khuyên "đừng nghĩ về scale." Đây là sự phân biệt giữa:

**Design for scale** — cấu trúc code theo cách không lock bạn vào một decision duy nhất. Không couple business logic vào infrastructure. Giữ stateless service. Dùng interface thay vì concrete implementation ở boundary quan trọng. Đây là thứ bạn nên làm ngay từ đầu.

**Implement scale** — add sharding, deploy Kafka cluster, spin up Kubernetes, implement distributed tracing. Đây là thứ bạn làm khi có signal cụ thể rằng hệ thống hiện tại không đủ.

Một là tư duy, một là hành động. Tư duy thì nên có sớm. Hành động thì chờ evidence.

---

## Signal cụ thể để bắt đầu scale

Không scale khi bạn *nghĩ* hệ thống sẽ cần. Scale khi bạn *đo được* hệ thống đang bị bottleneck.

Cụ thể, scale database khi query p99 vượt ngưỡng acceptable dù index đã đúng và connection pool đã tuned. Scale service khi một component consume resource quá mức và ảnh hưởng đến component khác. Add cache khi bạn đo được database load thật sự là bottleneck.

Trong HMS, nếu bạn thấy query `findAvailableSlots` chạy 50ms trong development với vài chục record, đừng vội cache. Deploy lên production, đo thật, rồi quyết định. Có thể với index đúng và MySQL buffer pool warm, nó chạy 5ms và không cần cache.

---

## Kỹ thuật giúp bạn scale sau mà không cần refactor lớn

Design for change không tốn nhiều effort nếu bạn biết những điểm nào thường phải thay đổi:

```java
// ✅ Stateless service — horizontal scale sau bằng cách thêm instance
@Service
public class AppointmentService {
    // Không có state ở field level (trừ injected dependencies)
    // Mọi state đều trong method scope hoặc database
}
```

```java
// ✅ Repository abstraction — swap implementation sau nếu cần
public interface AppointmentRepository extends JpaRepository<Appointment, UUID> {
    List<Appointment> findByPatientIdAndStatus(UUID patientId, AppointmentStatus status);
}
// Hiện tại dùng JPA. Sau này nếu cần, thêm một implementation khác 
// mà AppointmentService không biết gì.
```

Không có gì fancy ở đây. Đây là basic Spring Boot pattern. Nhưng nó đặt bạn vào vị trí có thể scale khi cần, không phải scale ngay bây giờ.

---

## Một điều bạn sẽ không đọc trong sách giáo khoa

Hầu hết startup chết không phải vì hệ thống không scale. Chúng chết vì không tìm được product-market fit trước khi hết tiền và resource. Thứ giết chúng là development quá chậm, quá cứng để pivot, quá phức tạp để onboard người mới.

Scaling là vấn đề sang trọng — bạn chỉ gặp nó khi đã có đủ user để lo. Trước khi đến đó, vấn đề thực sự là ship feature đủ nhanh để validate hypothesis.

---

## Takeaway

*"Optimize for now, architect for change"* — ship thứ đơn giản nhất có thể hoạt động hôm nay, nhưng viết nó theo cách không lock bạn vào quyết định sai khi scale thật sự cần thiết. Đó là balance thực tế, không phải theory.

---

*Bài tiếp theo: More layers không phải lúc nào cũng là design tốt hơn*
