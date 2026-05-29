---
title: "CORS — tại sao browser block và config đúng trong Spring"
description: "Postman chạy được, browser báo CORS error. Same-origin policy, preflight OPTIONS, và cách cấu hình CorsConfigurationSource trong Spring Security."
category: system-design
pubDate: 2026-05-25
series: "Phần 7: Backend Internals"
tags: ["backend", "CORS", "spring", "security"]
---


Frontend React chạy `localhost:5173`. API Spring Boot chạy `localhost:8080`. Mày gọi `fetch('/api/appointments')` — Postman trả 200 đầy đủ JSON. Browser console đỏ lòm:

```
Access to fetch at 'http://localhost:8080/api/appointments' from origin
'http://localhost:5173' has been blocked by CORS policy
```

Không phải backend down. Không phải JWT sai. **Browser** chủ động chặn response vì server không cho phép origin `5173` đọc resource từ `8080`.

Junior thường mất nửa ngày sửa JWT, CORS filter copy từ Stack Overflow, rồi mới hiểu CORS không phải lỗi server — là **cơ chế bảo vệ của browser**.

---

## Same-origin policy — browser không tin mọi JavaScript

Hai URL cùng **origin** khi protocol, host, port giống nhau:

| URL A | URL B | Cùng origin? |
|-------|-------|--------------|
| `http://localhost:5173` | `http://localhost:5173/api` | Có |
| `http://localhost:5173` | `http://localhost:8080` | Không (port khác) |
| `https://hms.example.com` | `https://api.hms.example.com` | Không (host khác) |

Trang web độc hại `evil.com` không được đọc response từ `bank.com` khi user đang login ngân hàng — JavaScript trên `evil.com` bị same-origin policy chặn.

CORS (Cross-Origin Resource Sharing) là cách **server nói với browser**: *"Origin X được phép đọc response của tôi."* Browser enforce; Postman và curl **không** enforce — đó là lý do mày thấy "API chạy được mà frontend không".

---

## Simple request vs preflight

Browser phân loại request:

**Simple request** (ít gặp với API hiện đại): GET, HEAD, POST với content-type `application/x-www-form-urlencoded`, `multipart/form-data`, `text/plain` — không cần preflight nếu chỉ dùng header "simple".

**Preflight** — hầu hết HMS API:

- Method: `PUT`, `DELETE`, `PATCH`
- Header: `Authorization`, `Content-Type: application/json`
- Custom header: `X-Request-Id`

Trước request thật, browser gửi **OPTIONS**:

```
OPTIONS /api/appointments/123
Origin: http://localhost:5173
Access-Control-Request-Method: DELETE
Access-Control-Request-Headers: authorization, content-type
```

Server phải trả:

```
Access-Control-Allow-Origin: http://localhost:5173
Access-Control-Allow-Methods: DELETE, GET, ...
Access-Control-Allow-Headers: authorization, content-type
Access-Control-Max-Age: 3600
```

Browser thấy OK → mới gửi DELETE thật kèm JWT. Nếu OPTIONS fail hoặc thiếu header → request thật **không được gửi**, console báo CORS.

Bug phổ biến: Spring Security chặn OPTIONS vì chưa `permitAll` — preflight never reaches CORS filter.

---

## Config CORS trong Spring Boot 3 + Security

**Cách 1 — `WebMvcConfigurer`** (chỉ MVC, chưa đủ nếu Security chặn trước):

```java
@Configuration
public class WebConfig implements WebMvcConfigurer {
  @Override
  public void addCorsMappings(CorsRegistry registry) {
    registry.addMapping("/api/**")
        .allowedOrigins("http://localhost:5173", "https://hms.example.com")
        .allowedMethods("GET", "POST", "PUT", "DELETE", "PATCH", "OPTIONS")
        .allowedHeaders("*")
        .allowCredentials(true)
        .maxAge(3600);
  }
}
```

**Cách 2 — tích hợp Spring Security** (HMS nên dùng):

```java
@Bean
public CorsConfigurationSource corsConfigurationSource(
    @Value("${hms.cors.allowed-origins}") List<String> allowedOrigins) {
  CorsConfiguration config = new CorsConfiguration();
  config.setAllowedOrigins(allowedOrigins); // không dùng * khi allowCredentials=true
  config.setAllowedMethods(List.of("GET", "POST", "PUT", "DELETE", "PATCH", "OPTIONS"));
  config.setAllowedHeaders(List.of("Authorization", "Content-Type", "X-Request-Id"));
  config.setAllowCredentials(true);
  config.setMaxAge(3600L);

  UrlBasedCorsConfigurationSource source = new UrlBasedCorsConfigurationSource();
  source.registerCorsConfiguration("/api/**", config);
  return source;
}

@Bean
public SecurityFilterChain filterChain(HttpSecurity http,
    CorsConfigurationSource corsConfigurationSource) throws Exception {
  return http
      .cors(cors -> cors.configurationSource(corsConfigurationSource))
      .csrf(csrf -> csrf.disable()) // API stateless JWT — hiểu trade-off CSRF
      .authorizeHttpRequests(auth -> auth
          .requestMatchers(HttpMethod.OPTIONS, "/api/**").permitAll()
          .requestMatchers("/api/public/**").permitAll()
          .anyRequest().authenticated()
      )
      .oauth2ResourceServer(oauth2 -> oauth2.jwt(Customizer.withDefaults()))
      .build();
}
```

`allowedOrigins` từ env — dev `localhost:5173`, prod domain thật. **Không** `allowedOrigins("*")` kèm `allowCredentials(true)` — browser reject combination này.

---

## Credentials và JWT

Frontend gửi cookie hoặc `Authorization: Bearer`:

```javascript
fetch('http://localhost:8080/api/appointments', {
  credentials: 'include',
  headers: { Authorization: `Bearer ${token}` }
});
```

Server phải `Allow-Credentials: true` và origin cụ thể — không wildcard.

Keycloak JWT trên header `Authorization` là case thường gặp — đảm bảo `Authorization` nằm trong `allowedHeaders` và preflight OPTIONS được permit.

---

## CORS không thay thế authentication

CORS chỉ nói browser có cho JS đọc response không. **Không** ngăn attacker gọi API bằng curl. Mọi endpoint vẫn cần JWT, `@PreAuthorize`, rate limit.

Đừng "fix CORS" bằng `@CrossOrigin(origins = "*")` trên mọi controller rồi bỏ quên security — đó là mở cửa cho browser từ mọi origin đọc response nếu user đã có token.

---

## Debug nhanh

1. Network tab → có OPTIONS không? Status?
2. Response headers có `Access-Control-Allow-Origin` đúng origin (không phải `*` khi có credentials)?
3. Spring Security có `permitAll` OPTIONS?
4. So sánh Postman vs browser — khác nhau là CORS, không phải logic API

---

## Takeaway

CORS là contract giữa **browser** và **server**, không phải giữa Postman và server. Preflight OPTIONS phải pass trước DELETE/PUT có JWT. Config origin theo môi trường, không wildcard khi dùng credentials. Và khi senior nói "fix CORS đúng chỗ" — họ muốn `CorsConfigurationSource` + Security chain, không phải tắt security cho tiện.

---

*Bài tiếp theo: Spring Security filter chain — request đi qua những gì trước controller.*
