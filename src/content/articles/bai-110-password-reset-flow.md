---
title: "Password reset flow — one-time token, expiry, và tại sao không gửi password trong URL"
description: "Reset link mang token ngẫu nhiên có TTL, hash trong DB, invalidate sau dùng. Không bao giờ đặt password mới hoặc password cũ trong query string."
category: system-design
pubDate: 2026-05-28
series: "Phần 10: Case Studies thực tế"
tags: ["case-study", "security", "authentication", "Keycloak"]
---


User bấm "Quên mật khẩu", nhập email, nhận link:

```
https://hms.example.com/reset-password?password=TempPass123&userId=abc-uuid
```

Junior nghĩ tiện — frontend đọc query param, gọi API đổi password xong. Link forward qua Slack, lộ trong browser history, server access log, Referer header khi load asset — **password mới chưa đổi đã public**.

Senior reject không vì UX. Vì **reset flow là security feature**, không phải form CRUD thông thường.

---

## Flow đúng — token, không phải password

```
1. POST /api/auth/forgot-password  { "email": "patient@example.com" }
2. Server: luôn trả 200 OK với response giống nhau dù email tồn tại hay không (không leak)
3. Nếu user tồn tại: tạo reset token, lưu hash, gửi email link
4. Link: https://hms.example.com/reset?token=<random>
5. POST /api/auth/reset-password  { "token": "...", "newPassword": "..." }
6. Server: verify token, đổi password (Keycloak), invalidate token
```

User chỉ nhập **password mới** trên trang HTTPS sau khi click link. Password **không** xuất hiện trong URL, email subject, hay log.

---

## One-time token — thiết kế

```java
@Entity
public class PasswordResetToken {
  @Id
  private UUID id;
  private UUID userId;
  private String tokenHash;      // lưu SHA-256(token), không lưu plain
  private Instant expiresAt;     // ví dụ now + 15 phút
  private Instant usedAt;        // null = chưa dùng
  private Instant createdAt;
}
```

Generate:

```java
String rawToken = SecureRandomHolder.generateUrlSafe(32); // 256-bit entropy
String hash = sha256(rawToken);
save(new PasswordResetToken(userId, hash, Instant.now().plus(Duration.ofMinutes(15))));

String link = frontendBaseUrl + "/reset?token=" + urlEncode(rawToken);
emailService.sendResetLink(user.getEmail(), link);
```

Verify:

```java
public void resetPassword(String rawToken, String newPassword) {
  var hash = sha256(rawToken);
  var entity = tokenRepository.findByTokenHashAndUsedAtIsNull(hash)
      .filter(t -> t.getExpiresAt().isAfter(Instant.now()))
      .orElseThrow(() -> new BadRequestException("INVALID_OR_EXPIRED_TOKEN"));

  keycloakService.setPassword(entity.getUserId(), newPassword);
  entity.setUsedAt(Instant.now());
  tokenRepository.save(entity);
  tokenRepository.deleteAllByUserIdAndUsedAtIsNull(entity.getUserId()); // invalidate token cũ
}
```

**One-time**: sau `usedAt` set, cùng token không dùng lại.  
**Expiry**: 15–60 phút tùy risk — ngắn hơn cho admin account.  
**Hash**: DB leak không lộ token usable.

---

## Tại sao không password trong URL

URL được:

- Lưu browser history
- Ghi access log nginx, CDN, analytics
- Leak qua `Referer` khi trang load third-party resource
- Share nhầm screenshot
- Cache bởi proxy

Query string là **plain text** end-to-end trong nhiều hệ thống logging. Password trong URL vi phạm OWASP, PCI common sense, và common sense.

Token random trong URL vẫn có risk (history, Referer) nhưng:

- Token **thay thế** password — chỉ dùng một lần, TTL ngắn
- Trang reset nên `Referrer-Policy: no-referrer`
- HTTPS bắt buộc

Không so sánh được với đặt password thật trong URL.

---

## Không leak email enumeration

```java
@PostMapping("/forgot-password")
@ResponseStatus(HttpStatus.ACCEPTED)
public void forgotPassword(@RequestBody ForgotPasswordRequest req) {
  userRepository.findByEmail(req.email())
      .ifPresent(this::createAndSendResetToken);
  // không throw 404 khi email không tồn tại
}
```

Attacker scan email registered hay không bằng response khác nhau — response luôn giống nhau, delay tương đương (có thể thêm constant-time sleep).

---

## Keycloak integration

HMS dùng Keycloak — đừng tự lưu password hash song song trừ khi có lý do. Flow:

1. App tạo reset token trong DB app
2. User submit password mới + token
3. App verify token → gọi Keycloak Admin API hoặc trigger Keycloak's built-in reset email

Nhiều team dùng **Keycloak forgot password** email template sẵn — app chỉ redirect. Custom flow khi cần branding email HMS hoặc OTP thêm bước.

Dù path nào: password mới chỉ đi qua **POST body HTTPS** tới endpoint hoặc Keycloak token endpoint — không query param.

---

## Rate limit và abuse

`POST /forgot-password` — rate limit theo IP và email (ví dụ 3 lần / giờ). Tránh spam email và token flooding.

Log audit: ai request reset, IP, thời điểm — không log token raw.

---

## Takeaway

Reset password = cấp **quyền tạm thời** qua one-time token có expiry, hash trong DB, invalidate sau dùng. Link email chỉ mang token. Password mới chỉ qua form POST. Và nếu mày thấy `?password=` trong URL bất kỳ đâu — xóa feature đó trước khi merge, không phải sau khi security audit.

---

*Bài tiếp theo: File upload đúng cách — multipart, streaming, S3 presigned URL.*
