---
title: "JWT là gì — và tại sao token không phải session"
description: "Session lưu state ở server, JWT tự chứa thông tin và server không cần nhớ gì. Anatomy của một JWT, verify flow, access token vs refresh token, và tại sao JWT không thể revoke ngay."
category: system-design
pubDate: 2024-04-19
series: "Phần 7: Backend & Hệ thống"
tags: ["backend", "JWT", "authentication", "security"]
---

---

Có một câu hỏi tưởng đơn giản mà nhiều dev trả lời sai: "Làm sao server biết request này đến từ user đã đăng nhập?"

Câu trả lời quen thuộc: "User đăng nhập, server tạo session, lưu vào memory hoặc database, trả về session ID, client gửi session ID theo mỗi request."

Câu trả lời đúng cho hầu hết modern system: không có session nào cả.

---

## Session có vấn đề gì

Session-based authentication trông như thế này:

```
Client → Login → Server
Server → Lưu {sessionId: "abc123", userId: "user-001"} vào memory
Server → Trả về cookie với sessionId "abc123"
Client → Gửi request kèm cookie "abc123"
Server → Lookup "abc123" trong memory → Tìm thấy → Biết đây là user-001
```

Vấn đề xuất hiện ngay khi mày có nhiều hơn một server. Server A lưu session của user X. User X gửi request đến Server B — Server B không có session đó, coi như chưa đăng nhập.

Giải pháp cổ điển: sticky session (mọi request của user phải đến cùng server) hoặc centralized session store (Redis). Cả hai đều thêm complexity. Và khi Keycloak authentication server của mày nằm tách biệt với application server — session store trung tâm trở thành bottleneck.

JWT sinh ra để giải quyết vấn đề này bằng cách đảo ngược mô hình: thay vì server lưu state, **state nằm trong token mà client giữ**.

---

## JWT trông như thế nào

JWT là một string có format: `header.payload.signature`

```
eyJhbGciOiJSUzI1NiJ9.eyJzdWIiOiJ1c2VyLTAwMSIsInJvbGVzIjpbIlJPTEVfUEFUSUVOVCJdLCJleHAiOjE3MDUzMjgwMDB9.abc123signature
```

Decode ra:

```json
// Header
{
  "alg": "RS256",
  "typ": "JWT"
}

// Payload
{
  "sub": "user-001",            // userId
  "roles": ["ROLE_PATIENT"],    // permissions
  "exp": 1705328000,            // expiry timestamp
  "iat": 1705241600             // issued at
}

// Signature — không decode được nếu không có private key
```

Khi server nhận JWT, nó không lookup database. Nó verify signature bằng public key — nếu signature hợp lệ, payload là trustworthy. Không cần round-trip đến bất kỳ storage nào.

---

## Tại sao server tin tưởng payload này

Đây là phần mà nhiều người bỏ qua. JWT không mã hóa payload — mày có thể decode base64 payload và đọc nội dung. Vậy tại sao client không tự sửa `"roles": ["ROLE_ADMIN"]` rồi gửi lên?

Vì signature.

Signature được tạo bằng private key của Keycloak từ `header + payload`. Nếu mày thay đổi bất kỳ byte nào trong payload, signature sẽ không còn khớp với public key nữa. Server verify signature trước khi đọc payload — token bị tamper là token bị reject ngay lập tức.

Trong HMS với Spring Boot và Keycloak:

```java
// Spring Security tự động verify JWT với Keycloak public key
// Mày chỉ cần config endpoint
@Configuration
public class SecurityConfig {
    
    @Bean
    public SecurityFilterChain filterChain(HttpSecurity http) throws Exception {
        http
            .oauth2ResourceServer(oauth2 -> oauth2
                .jwt(jwt -> jwt.decoder(jwtDecoder()))
            );
        return http.build();
    }
    
    @Bean
    public JwtDecoder jwtDecoder() {
        // Tự động fetch public key từ Keycloak JWKS endpoint
        return NimbusJwtDecoder.withJwkSetUri(keycloakJwksUri).build();
    }
}
```

Sau khi verify, Spring Security populate `SecurityContext` với claims từ JWT — và mày access trong code:

```java
@Component
public class UserContext {
    
    public UUID getCurrentUserId() {
        Jwt jwt = (Jwt) SecurityContextHolder.getContext()
            .getAuthentication().getPrincipal();
        return UUID.fromString(jwt.getSubject());
    }
    
    public boolean hasRole(String role) {
        Jwt jwt = (Jwt) SecurityContextHolder.getContext()
            .getAuthentication().getPrincipal();
        List<String> roles = jwt.getClaimAsStringList("roles");
        return roles != null && roles.contains(role);
    }
}
```

---

## Cái giá phải trả: token không thể revoke ngay lập tức

Đây là trade-off mà JWT mang lại và không có cách giải quyết hoàn toàn.

Với session: mày muốn force logout user — xóa session trong database, xong. Lần request tiếp theo của user sẽ fail.

Với JWT: mày không thể "xóa" token đang tồn tại ở phía client. Token sống cho đến khi hết hạn (`exp`). Nếu token expire sau 1 giờ mà mày muốn revoke ngay lập tức — mày có vấn đề.

Giải pháp phổ biến: **JWT blacklist trong Redis**.

```java
// Khi user logout, thêm JTI (JWT ID) vào blacklist
public void logout(String token) {
    Jwt jwt = jwtDecoder.decode(token);
    String jti = jwt.getId();
    Duration ttl = Duration.between(Instant.now(), jwt.getExpiresAt());
    
    // Lưu vào Redis với TTL bằng thời gian còn lại của token
    redisTemplate.opsForValue().set("jwt:blacklist:" + jti, "1", ttl);
}

// Khi nhận request, kiểm tra blacklist trước
public boolean isTokenRevoked(Jwt jwt) {
    return Boolean.TRUE.equals(
        redisTemplate.hasKey("jwt:blacklist:" + jwt.getId())
    );
}
```

Đây là pattern HMS đang dùng — stateless authentication với Redis-backed revocation cho những trường hợp cần revoke ngay.

---

## Access Token vs Refresh Token

Một điểm nữa hay gây nhầm lẫn: tại sao có hai loại token?

**Access Token:** short-lived (15 phút đến 1 giờ), dùng để authenticate từng request. Nếu bị stolen, thiệt hại giới hạn trong thời gian còn lại.

**Refresh Token:** long-lived (ngày hoặc tuần), lưu ở nơi an toàn hơn, chỉ dùng để lấy Access Token mới. Không gửi theo mọi request.

Khi Access Token hết hạn, client dùng Refresh Token để lấy Access Token mới từ Keycloak — user không cần đăng nhập lại. Khi muốn force logout, revoke Refresh Token — user sẽ bị đẩy ra sau khi Access Token hiện tại hết hạn.

---

## Takeaway

JWT không phải "session mới hơn" — đó là một mô hình khác hoàn toàn với trade-off khác. Stateless = không cần centralized storage = scale dễ hơn. Nhưng stateless cũng = không thể revoke ngay lập tức = cần blacklist nếu security là priority. Hiểu trade-off trước khi chọn, đừng chọn vì "JWT là modern".

---

*Bài tiếp theo: Logging đúng cách — vì sao log của mày đang vô dụng lúc cần nhất.*
