---
title: "API Gateway vs Load Balancer — hai thứ khác nhau nhưng hay bị gộp làm một"
description: "Load balancer phân phối traffic. Gateway xử lý auth, routing, transformation. Hiểu đúng để design microservices đúng."
category: system-design
pubDate: 2026-07-05
series: "Phần 8: System Design"
tags: ["api-gateway", "load-balancer", "microservices", "system-design", "interview"]
---

Phỏng vấn system design, interviewer hỏi: "Bạn có nhiều service, client cần gọi vào — bạn đặt gì trước các service đó?" Người mới trả lời: "Load balancer." Người có kinh nghiệm trả lời: "Tùy — load balancer, API gateway, hay cả hai, tùy bài toán."

Câu trả lời khác nhau không phải vì người có kinh nghiệm biết nhiều từ hơn. Họ hiểu hai thứ này giải quyết **vấn đề khác nhau**.

---

## Load balancer làm gì

Load balancer (bài 70) có một nhiệm vụ duy nhất: **phân phối traffic vào nhiều instance** của cùng một service.

```
Client → [Load Balancer] → AppointmentService instance 1
                        → AppointmentService instance 2
                        → AppointmentService instance 3
```

Nó không biết — và không cần biết — request đó là gọi `GET /appointments` hay `POST /payments`. Nó chỉ hỏi: instance nào còn khỏe, instance nào có ít load nhất, tôi route vào đó.

Load balancer hoạt động ở tầng **network/transport** (Layer 4) hoặc tầng **HTTP** (Layer 7). AWS ALB, Nginx upstream, HAProxy là load balancer. Chúng không đọc JWT, không biết user là ai, không transform request body.

---

## API Gateway làm gì

API Gateway đứng trước **nhiều service khác nhau** và xử lý những thứ mà mọi service đều cần — thay vì để từng service tự làm:

**Authentication & Authorization** — validate JWT token, check nếu user có quyền gọi endpoint này. Nếu không qua, reject trước khi request chạm service thật.

**Routing** — `GET /appointments` đến `AppointmentService`, `POST /payments` đến `PaymentService`, `GET /patients` đến `PatientService`. Client chỉ biết một base URL.

**Rate limiting** — mỗi client được gọi tối đa N request/phút, áp dụng uniform cho toàn bộ API thay vì config trong từng service.

**Request/Response transformation** — đôi khi cần đổi format, thêm header, aggregate response từ nhiều service thành một response cho client mobile.

**SSL termination** — decrypt HTTPS một lần ở gateway, traffic nội bộ giữa gateway và service có thể là HTTP thuần (trong trusted network).

```
                    ┌─────────────────────┐
Client ──→ [API     │ - Auth/JWT validate │
           Gateway] │ - Rate limit        │ ──→ AppointmentService
           :443     │ - Route /appt → svc │ ──→ PaymentService
                    │ - Route /pay → svc  │ ──→ PatientService
                    └─────────────────────┘
```

---

## Điểm khác nhau thực tế

Hiểu khác nhau rõ nhất qua ví dụ: HMS có 4 service và 3,000 request/phút.

Load balancer một mình:

```
Client → [LB] → AppointmentService instance A
             → AppointmentService instance B
```

Client phải biết AppointmentService URL, PaymentService URL, PatientService URL riêng. JWT validate phải code trong từng service. Rate limit phải code trong từng service. Khi thêm service mới, client phải biết thêm URL mới.

API Gateway + Load balancer:

```
Client → [API Gateway :443]
              │ auth OK, route /api/appointments
              ↓
         [LB] → AppointmentService A
              → AppointmentService B

              │ auth OK, route /api/payments
              ↓
         [LB] → PaymentService A
              → PaymentService B
```

Client chỉ cần biết một endpoint: `https://api.hms.example.com`. Gateway lo routing, auth, rate limit. Từng service lo business logic.

---

## Một điểm hay nhầm: gateway không thay load balancer

Nhiều gateway có tính năng load balance tích hợp. Kong, AWS API Gateway, Spring Cloud Gateway — đều có thể route đến nhiều instance theo round-robin. Vậy có cần LB riêng không?

Phụ thuộc scale và topology:

Nếu bạn dùng Kubernetes, K8s Service đã là load balancer cho từng deployment. Gateway route đến K8s Service name, K8s lo phân phối vào các pod. Không cần LB riêng cho internal routing.

Nếu bạn không có K8s, dùng bare-metal hay VM, thì gateway + LB riêng biệt (hoặc gateway đảm nhiệm cả hai) là hướng đi.

Điểm quan trọng: gateway và load balancer giải quyết problem ở **hai tầng khác nhau**, không phải cạnh tranh nhau.

---

## Spring Cloud Gateway — khi HMS cần gateway tự build

Nếu không muốn dùng Kong hay AWS API Gateway (vendor dependency, cost), Spring Cloud Gateway là lựa chọn in-house:

```yaml
# application.yml của gateway service
spring:
  cloud:
    gateway:
      routes:
        - id: appointment-service
          uri: lb://appointment-service  # lb:// = load balance qua discovery
          predicates:
            - Path=/api/appointments/**
          filters:
            - StripPrefix=1  # Bỏ /api trước khi forward

        - id: payment-service
          uri: lb://payment-service
          predicates:
            - Path=/api/payments/**
          filters:
            - StripPrefix=1
```

Auth filter global — áp dụng cho tất cả route:

```java
@Component
@RequiredArgsConstructor
public class JwtAuthFilter implements GlobalFilter {

    private final JwtValidator jwtValidator;

    @Override
    public Mono<Void> filter(ServerWebExchange exchange, GatewayFilterChain chain) {
        String token = extractBearerToken(exchange.getRequest());

        if (token == null || !jwtValidator.isValid(token)) {
            exchange.getResponse().setStatusCode(HttpStatus.UNAUTHORIZED);
            return exchange.getResponse().setComplete();
        }

        // Token hợp lệ — forward request, thêm user info vào header
        ServerHttpRequest mutatedRequest = exchange.getRequest().mutate()
            .header("X-User-Id", jwtValidator.getUserId(token))
            .header("X-User-Roles", jwtValidator.getRoles(token))
            .build();

        return chain.filter(exchange.mutate().request(mutatedRequest).build());
    }
}
```

Từng downstream service nhận `X-User-Id` từ header — không cần validate JWT lại, tin tưởng gateway đã làm.

---

## Khi nào cần gateway, khi nào không

Một service, một team nhỏ, internal tool — không cần gateway. Thêm gateway là thêm một service phải deploy, monitor, fail.

Khi hợp lý để đưa gateway vào:

Có nhiều service và client (web, mobile, third-party) gọi vào — gateway là single entry point, dễ quản lý hơn là mỗi service expose URL riêng ra ngoài.

Cross-cutting concerns như auth và rate limit bắt đầu bị duplicate ở nhiều service — dấu hiệu nên centralize.

Cần transform response cho different client (mobile cần lightweight response, web cần full data) — gateway aggregate và shape.

---

## Takeaway

Load balancer hỏi: "Instance nào nhận request này?" API Gateway hỏi: "Request này có quyền gọi không, và nên đến service nào?" Trong microservices, thường cần cả hai — gateway ở ngoài cùng xử lý auth và routing, load balancer phía sau phân phối vào từng instance. Nhầm hai khái niệm này là thiết kế thiếu một tầng quan trọng.

---

*Bài tiếp theo: Distributed Tracing — khi request chết ở đâu trong chuỗi service?*
