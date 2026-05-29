---
title: "API versioning — /v1/ trong URL hay header, và khi nào breaking"
description: "Đổi field response là đổi contract — versioning, deprecation có hạn, và phân biệt breaking vs non-breaking change."
category: programming
pubDate: 2026-06-01
series: "Phần 7: Backend & Hệ thống"
tags: ["api", "rest", "versioning", "spring"]
---

Mobile app HMS v2.1 đang parse `appointment.status` là string `"CONFIRMED"`. Backend deploy đổi thành object `{ "code": "CONFIRMED", "label": "..." }` — không báo trước. App crash màn hình lịch hẹn dù server “chạy đúng spec mới”.

API là **contract** (bài 69). Versioning không phải trang trí — là cách cho client cũ sống trong khi client mới lên.

---

## URL path vs header — chọn một, nhất quán

**Path versioning** — phổ biến, dễ debug:

```http
GET /api/v1/appointments/{id}
GET /api/v2/appointments/{id}
```

```java
@RestController
@RequestMapping("/api/v1/appointments")
public class AppointmentV1Controller { ... }

@RestController
@RequestMapping("/api/v2/appointments")
public class AppointmentV2Controller { ... }
```

**Header versioning** — URL sạch, client gửi `Accept: application/vnd.hms.appointment+json;version=2` hoặc custom `X-API-Version: 2`. Khó test hơn trên browser, log ít thấy version hơn path.

HMS team thường chọn **`/api/v1/`** vì:

- Log, WAF, rate limit theo path rõ
- Postman/curl copy paste không quên header
- Gateway route đơn giản

Quan trọng: **một convention cho toàn bộ public API**, không v1 path + v2 header lẫn lộn.

---

## Non-breaking vs breaking change

**Non-breaking** (client cũ vẫn chạy):

- Thêm field **optional** trong JSON response (client ignore field lạ)
- Thêm endpoint mới
- Thêm giá trị enum **mới** nếu client switch/default unknown (cẩn thận với strict enum)

**Breaking** (cần version mới hoặc coordination):

- Đổi tên/xóa field
- Đổi kiểu (`status` string → object)
- Đổi semantics (`total` cents → dollars)
- Bắt buộc query param mới

```java
// ✅ v2 thêm field — v1 client vẫn parse được
public record AppointmentResponseV1(
    UUID id,
    String status,
    LocalDateTime scheduledAt
) {}

public record AppointmentResponseV2(
    UUID id,
    StatusDetail status,  // breaking nếu đổi trên cùng URL v1
    LocalDateTime scheduledAt,
    String clinicTimezone   // additive OK trên v1 nếu optional
) {}
```

Rule thực dụng: **nếu không chắc → coi là breaking → v2**.

---

## Deprecation có kế hoạch

Xóa `/v1` đột ngột = break app store build cũ.

1. Announce: header `Deprecation: true`, `Sunset: Sat, 01 Nov 2026 00:00:00 GMT` (RFC 8594 — client/tooling có thể đọc)
2. Metric: % traffic còn vào v1
3. Chỉ tắt v1 khi dưới ngưỡng team chấp nhận (vd < 0.1%) hoặc force upgrade mobile

```java
@GetMapping("/api/v1/appointments/{id}")
public ResponseEntity<AppointmentResponseV1> getV1(@PathVariable UUID id) {
  return ResponseEntity.ok()
      .header("Deprecation", "true")
      .header("Sunset", "Sat, 01 Nov 2026 00:00:00 GMT")
      .header("Link", "</api/v2/appointments/{id}>; rel=\"successor-version\"")
      .body(service.getV1(id));
}
```

Internal service-to-service: có thể deploy cùng lúc cả hai bên. **Public/mobile**: luôn giả định client chậm vài tháng.

---

## Versioning không cứu API tệ

Nếu mỗi sprint thêm `/v3` vì đổi tên field bừa — mày đang trả nợ thiết kế (bài 69). DTO tách entity, additive changes trên v1 trước khi nhảy v2.

---

## Takeaway

Public API HMS: path `/api/v1/`, document breaking change, sunset có ngày. Trước khi đổi shape JSON: hỏi app mobile còn bao nhiêu build cũ — nếu nhiều, thêm v2 thay vì “sửa luôn v1”.

---

*Bài tiếp theo: @Async trong Spring — CompletableFuture và pitfall với @Transactional*
