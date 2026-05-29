---
title: "Read replica lag — vì sao đọc stale ngay sau khi write"
description: "Replica async sau primary — read-your-writes, route sau mutation, và khi nào chấp nhận eventual consistency."
category: system-design
pubDate: 2026-06-07
series: "Phần 6: Database"
tags: ["database", "replication", "consistency", "mysql"]
---

Bệnh nhân vừa đổi họ tên, API trả 200. Refresh trang profile — **tên cũ** vài giây. Dev bảo “cache” — nhưng đã xóa Redis. Thực ra read đi **replica MySQL**, write đi **primary**, replica chưa kịp apply binlog.

Đây là **replication lag** — không phải bug ngẫu nhiên, là hệ quả kiến trúc.

---

## Vì sao replica luôn “đi sau” một nhịp

MySQL replication mặc định **asynchronous**: primary commit xong trả client, replica nhận binlog và apply **sau**. Tải cao, replica yếu hơn primary, migration nặng, long transaction trên replica — lag tăng từ vài ms lên giây.

Junior hay tưởng: *“Có 2 DB thì gấp đôi an toàn và đồng bộ tức thì.”* Thực tế: **scale read** đổi lấy **eventual consistency** trên read path.

---

## Triệu chứng trong HMS

- Đặt lịch xong → list appointment ngay không thấy slot mới
- Admin sửa role Keycloak/DB → permission check replica cũ
- Integration test pass (một DB) → prod fail (read/write split)

Khác cache stale (bài 88): invalidate Redis không fix replica lag.

---

## Read-your-writes — pattern thực dụng

Sau mutation quan trọng, **đọc từ primary** trong cửa sổ ngắn:

```java
@Service
@RequiredArgsConstructor
public class PatientService {

  @Transactional  // write — luôn primary khi dùng routing datasource
  public PatientResponse updateProfile(UUID id, UpdateRequest req) {
    Patient saved = patientRepository.save(apply(req));
    return mapper.toResponse(saved);
  }

  @Transactional(readOnly = true)
  public PatientResponse getProfile(UUID id) {
    return mapper.toResponse(patientRepository.findById(id).orElseThrow());
  }
}
```

Với **routing datasource** theo thread context:

```java
// Sau write trong cùng request/session — force primary cho read tiếp theo
public PatientResponse updateAndReturn(UpdateRequest req) {
  PatientResponse updated = updateProfile(...);
  ReplicationContext.usePrimary(); // custom holder — clear sau request
  return getProfile(updated.getId());
}
```

Hoặc đơn giản hơn: **API “get ngay sau post”** trả body từ response write, không query replica.

Mobile app: sau `POST /appointments`, UI thêm item từ response JSON — không `GET /appointments` ngay lập tức nếu biết read path đi replica.

---

## Các hướng khác (khi lag lớn hoặc critical)

- **Monitor** `Seconds_Behind_Master` / Percona lag metric — alert khi lag > ngưỡng business chấp nhận
- **Session stickiness**: user vừa write → vài request sau route primary (cookie/header nội bộ)
- **Sync replication** (semi-sync): giảm rủi ro mất data, **không** đảm bảo read replica zero lag cho mọi read
- Chấp nhận stale cho **report/analytics** trên replica; **không** cho booking confirm ngay sau create

Đừng hứa “real-time” trên read replica nếu chưa đo lag p99 trên prod.

---

## Takeaway

Write primary, read replica → user có thể thấy data cũ ngay sau write. Với flow “sửa xong xem ngay”: read primary hoặc trả data từ write response. Dashboard báo cáo có thể chấp nhận lag — đặt lịch khám thì không.

---

*Bài tiếp theo: (tiếp Phần 6 hoặc Production & Ops)*
