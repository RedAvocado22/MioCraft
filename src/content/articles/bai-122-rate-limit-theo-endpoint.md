---
title: "Rate limit theo endpoint — cùng một user, khác hàng rào"
description: "Global limit 100 req/phút không cứu được POST /payments khi GET /schedules vẫn ổn. Cấu hình limit theo route, tier user, và trả header để client không retry vô hạn."
category: system-design
pubDate: 2026-05-29
series: "Phần 12: Production & Ops"
tags: ["rate-limiting", "redis", "api", "production"]
---

Bài 72 nói *có* rate limiting. Production hỏi tiếp: **limit bao nhiêu cho endpoint nào?**

Một bucket chung `100 req/phút/user` nghe công bằng — cho đến khi script scan `GET /api/doctors` 99 lần, user thật bấm `POST /api/appointments/book` lần thứ 101 và nhận 429. Hoặc ngược lại: attacker chỉ hammer endpoint book vì global limit còn dư từ traffic read nhẹ.

Rate limit **theo endpoint** (và đôi khi theo method) là tách hàng rào: read rộng, write chặt, webhook/auth cực chặt.

---

## Vì sao không một limit cho cả API

Mỗi endpoint có **chi phí** và **rủi ro** khác nhau:

| Endpoint | Đặc điểm | Hướng limit |
|----------|----------|-------------|
| `GET /api/doctor-schedules` | Read, cache được | Cao |
| `POST /api/appointments/book` | Write, Redis Lua, DB | Thấp |
| `POST /api/payments` | Side effect, gateway | Rất thấp |
| `POST /webhooks/payment` | Không JWT user — theo IP/signature | Riêng |

Junior hay gắn một `@RateLimiter` global. Senior map **policy name → limit** trước khi viết filter.

---

## Key Redis: user + policy, không chỉ user

Bài 72 đã có Lua token bucket. Chỉ cần đổi key từ `rate_limit:{userId}` sang `rate_limit:{userId}:{policy}`:

```java
@Component
public class EndpointRateLimitPolicies {

  private final Map<String, RateLimitPolicy> byPathPrefix = Map.of(
      "/api/appointments/book", new RateLimitPolicy("book", 10, 1),      // 10 token, refill 1/s
      "/api/payments", new RateLimitPolicy("payment", 5, 0.2),
      "/api/doctor-schedules", new RateLimitPolicy("schedule_read", 60, 10)
  );

  public Optional<RateLimitPolicy> resolve(String requestUri) {
    return byPathPrefix.entrySet().stream()
        .filter(e -> requestUri.startsWith(e.getKey()))
        .map(Map.Entry::getValue)
        .findFirst();
  }
}

public record RateLimitPolicy(String name, int capacity, double refillPerSecond) {}
```

```java
// Filter — chỉ áp dụng khi có policy
if (policy.isPresent() && !rateLimiter.isAllowed(userId, policy.get())) {
  response.setStatus(429);
  response.setHeader("Retry-After", "30");
  response.setHeader("X-RateLimit-Policy", policy.get().name());
  return;
}
```

`RedisRateLimiter.isAllowed(userId, policy.name())` dùng cùng Lua script bài 72 — **một user có nhiều bucket độc lập**.

---

## Tier user (optional, đừng over-engineer sớm)

Bác sĩ nội bộ vs patient app có thể khác limit — key thêm dimension:

`rate_limit:{userId}:{policy}:{tier}`

Chỉ làm khi product yêu cầu. Mặc định một tier đủ cho HMS giai đoạn đầu.

---

## Webhook và anonymous traffic

`POST /webhooks/payment` không có `userId` từ JWT. Limit theo:

- IP gateway (whitelist CIDR nếu gateway cố định), hoặc
- Không rate limit ở app — để API gateway/WAF (vì volume thấp, đã verify HMAC bài 116)

Đừng copy filter JWT sang webhook rồi wonder vì sao gateway bị 429.

---

## Header và client retry

429 kèm `Retry-After` — frontend **không** tự retry ngay vòng lặp (đó là cách tạo DDoS nội bộ). Payment/booking: client dùng **idempotency key** (bài 84), không spam POST.

---

## Takeaway

Sau bài 72, bước tiếp theo: liệt kê endpoint write có side effect, gán policy name + capacity riêng, key Redis `userId:policy`. Một limit global là che mắt — book appointment và xem lịch không cùng một bucket.

---

*Bài tiếp theo: State machine thanh toán — cancel đã trả tiền và refund*
