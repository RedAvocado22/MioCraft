---
title: "Spring Security filter chain — request đi qua những gì trước controller"
description: "OncePerRequestFilter, JwtAuthenticationFilter, authorization vs authentication — và tại sao filter chạy trước @PreAuthorize."
category: system-design
pubDate: 2026-05-26
series: "Phần 7: Backend & Hệ thống"
tags: ["backend", "spring-security", "JWT", "filter"]
---


Bạn đặt breakpoint trong `AppointmentController.create()` — request đã có `Authentication` với `ROLE_PATIENT`, JWT đã parse xong, userId đã nằm trong `UserContext`. Nhưng bạn không gọi bất kỳ dòng code nào "login" trong controller.

Điều gì đã xảy ra giữa lúc TCP packet đến Tomcat và lúc method của bạn chạy? Nếu bạn không biết, bạn sẽ debug security sai chỗ — sửa controller trong khi lỗi nằm ở filter, hoặc ngược lại.

---

## Filter chain trước DispatcherServlet

Spring MVC không nhận request trực tiếp. Servlet container chạy **chuỗi filter**:

```
HTTP Request
  → CorsFilter
  → SecurityContextPersistenceFilter
  → LogoutFilter
  → BearerTokenAuthenticationFilter (OAuth2 Resource Server)
  → AuthorizationFilter
  → ... các filter khác
  → DispatcherServlet → Controller → Service
```

`SecurityFilterChain` là danh sách filter được Spring Security sắp xếp. Mỗi filter có thể **short-circuit** — trả 401/403 ngay, không vào controller.

Hiểu thứ tự giúp bạn biết: JWT validate **trước** `@PreAuthorize` chạy; CORS preflight **trước** authentication.

---

## Authentication vs Authorization

Hai khái niệm bị nhầm liên tục:

**Authentication** — *"Bạn là ai?"
Verify JWT signature, đọc `sub` (userId), roles từ Keycloak. Kết quả: object `Authentication` trong `SecurityContextHolder`.

**Authorization** — *"Bạn được làm gì?"
`@PreAuthorize("hasRole('DOCTOR')")`, `authorizeHttpRequests`, ABAC check bệnh nhân thuộc bác sĩ nào.

```java
@RestController
@RequestMapping("/api/medical-records")
public class MedicalRecordController {

  @GetMapping("/{id}")
  @PreAuthorize("hasRole('DOCTOR')")  // authorization — sau khi đã authenticated
  public MedicalRecordResponse get(@PathVariable UUID id) {
    return medicalRecordService.getById(id); // có thể thêm ABAC trong service
  }
}
```

JWT invalid → 401 ở filter (authentication fail). JWT hợp lệ nhưng role `PATIENT` gọi endpoint doctor → 403 (authorization fail).

---

## OncePerRequestFilter — mỗi request chỉ một lần

```java
public abstract class OncePerRequestFilter extends GenericFilterBean {
  // đảm bảo filter không chạy hai lần khi request forward/include
}
```

Custom filter nên extend class này — tránh double execution khi internal forward.

Ví dụ filter gắn correlation ID cho log:

```java
@Component
public class RequestIdFilter extends OncePerRequestFilter {

  @Override
  protected void doFilterInternal(HttpServletRequest request,
      HttpServletResponse response,
      FilterChain chain) throws ServletException, IOException {
    String requestId = Optional.ofNullable(request.getHeader("X-Request-Id"))
        .orElse(UUID.randomUUID().toString());
    MDC.put("requestId", requestId);
    response.setHeader("X-Request-Id", requestId);
    try {
      chain.doFilter(request, response); // chuyển sang filter tiếp theo
    } finally {
      MDC.clear();
    }
  }
}
```

Đăng ký thứ tự trong Security hoặc `FilterRegistrationBean` — filter chạy **trước** hay **sau** JWT tùy mục đích. Correlation ID thường **trước** mọi thứ.

---

## JWT trong Spring Boot 3 + Keycloak

Với `spring-boot-starter-oauth2-resource-server`:

```yaml
spring:
  security:
    oauth2:
      resourceserver:
        jwt:
          issuer-uri: ${KEYCLOAK_ISSUER_URI}
```

`BearerTokenAuthenticationFilter` extract `Authorization: Bearer`, validate với JWK từ Keycloak, build `JwtAuthenticationToken`. Không cần tự viết parse JWT trong controller — trừ khi có requirement đặc biệt (blacklist token trong Redis):

```java
@Component
public class JwtBlacklistFilter extends OncePerRequestFilter {
  private final TokenBlacklistService blacklist;

  @Override
  protected void doFilterInternal(...) {
    String token = extractBearer(request);
    if (token != null && blacklist.isRevoked(token)) {
      response.setStatus(HttpServletResponse.SC_UNAUTHORIZED);
      return; // dừng chain — không vào controller
    }
    chain.doFilter(request, response);
  }
}
```

Blacklist check **sau** khi token format hợp lệ hoặc **thay** một phần flow — thiết kế tùy product; quan trọng là biết filter này nằm **trong** Security chain.

---

## SecurityFilterChain — nơi bạn định nghĩa luật

```java
@Bean
public SecurityFilterChain apiSecurity(HttpSecurity http) throws Exception {
  return http
      .securityMatcher("/api/**")
      .cors(Customizer.withDefaults())
      .sessionManagement(s -> s.sessionCreationPolicy(SessionCreationPolicy.STATELESS))
      .authorizeHttpRequests(auth -> auth
          .requestMatchers("/api/health").permitAll()
          .requestMatchers("/api/auth/**").permitAll()
          .requestMatchers(HttpMethod.GET, "/api/doctors").permitAll()
          .requestMatchers("/api/admin/**").hasRole("ADMIN")
          .anyRequest().authenticated()
      )
      .oauth2ResourceServer(oauth2 -> oauth2.jwt(Customizer.withDefaults()))
      .exceptionHandling(ex -> ex
          .authenticationEntryPoint((req, res, e) -> res.sendError(401))
          .accessDeniedHandler((req, res, e) -> res.sendError(403))
      )
      .build();
}
```

`permitAll()` — không cần JWT.  
`authenticated()` — cần JWT hợp lệ, role cụ thể có thể để `@PreAuthorize`.

Thứ tự rule: **specific trước, `anyRequest` sau**. Rule đầu match wins.

---

## @PreAuthorize và method security

```java
@EnableMethodSecurity
@Configuration
public class MethodSecurityConfig {}
```

`@PreAuthorize` dùng AOP proxy trên bean — **sau** filter chain đã establish `SecurityContext`. Expression có thể gọi bean:

```java
@PreAuthorize("@medicalRecordAccess.canRead(#id, authentication)")
public MedicalRecordResponse get(UUID id) { ... }
```

ABAC phức tạp (bác sĩ chỉ xem bệnh nhân mình) thường nằm service layer kết hợp `@PreAuthorize` role cơ bản — đừng nhồi hết vào một SpEL dài 5 dòng.

---

## Controller không phải nơi đầu tiên chạy

Khi debug 401:

1. Request có header `Authorization` không?
2. Issuer URI đúng realm Keycloak không?
3. Token hết hạn? Clock skew?
4. Blacklist filter có chặn không?
5. `permitAll` có match nhầm không?

Khi debug 403:

1. JWT có role cần không? Keycloak realm role vs client role
2. `@PreAuthorize` expression
3. ABAC trong service

Sửa `@RestController` khi lỗi ở bước 1–4 là đi sai tầng.

---

## Takeaway

Request HMS đi qua filter chain dài trước khi chạm `AppointmentController`. Authentication xảy ra ở filter (JWT); authorization ở `authorizeHttpRequests` và `@PreAuthorize`. Custom logic (request ID, token blacklist) là `OncePerRequestFilter` đăng ký đúng thứ tự. Biết map này — debug security 30 phút thay vì 3 ngày.

---

*Bài tiếp theo: HTTP status codes đúng cách — 4xx, 5xx, 201 vs 200.*
