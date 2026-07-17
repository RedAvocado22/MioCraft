---
title: "Service Mesh là gì và khi nào bạn cần nó"
description: "Sidecar proxy pattern, control plane vs data plane, và câu hỏi quan trọng nhất: có phải lúc nào cũng cần không?"
category: system-design
pubDate: 2026-06-28
series: "Phần 8: System Design"
tags: ["service-mesh", "istio", "microservices", "system-design", "infrastructure"]
---

Bạn có 3 service gọi nhau. `AppointmentService` gọi `NotificationService`, gọi `PaymentService`. Retry? Viết trong từng service. Circuit breaker? Viết trong từng service. Timeout? Viết trong từng service. mTLS giữa service? Viết trong từng service.

Tạm ổn. Còn 3 service thì quản được.

Giờ company bạn scale lên 30 service. Code retry trong `AppointmentService` dùng Resilience4j 2.1, `NotificationService` vẫn dùng 1.7 với behavior khác nhau. `PaymentService` timeout config sai nên retry 5 lần thay vì 3. Bug ở chỗ không ai ngờ — không phải trong business logic, trong infra code duplicate ở 30 nơi.

Service mesh giải quyết bằng cách **đẩy toàn bộ tầng đó ra khỏi app code**.

---

## Sidecar proxy: ý tưởng cốt lõi

Thay vì mỗi service tự xử lý retry/timeout/circuit breaker/mTLS trong code, service mesh inject một **proxy nhỏ chạy cùng** mỗi service instance — gọi là **sidecar proxy**.

```
┌─────────────────────────────────┐
│  Pod (Kubernetes)               │
│  ┌──────────────────┐           │
│  │  AppointmentSvc  │ ←── bạn  │
│  │   (Spring Boot)  │    viết  │
│  └────────┬─────────┘           │
│           │ localhost           │
│  ┌────────▼─────────┐           │
│  │   Envoy Proxy    │ ←── mesh │
│  │   (sidecar)      │    inject│
│  └──────────────────┘           │
└─────────────────────────────────┘
         │ network
┌────────▼────────────────────────┐
│  Pod                            │
│  ┌──────────────────┐           │
│  │  NotificationSvc │           │
│  └────────┬─────────┘           │
│           │ localhost           │
│  ┌────────▼─────────┐           │
│  │   Envoy Proxy    │           │
│  └──────────────────┘           │
└─────────────────────────────────┘
```

Khi `AppointmentService` gọi `NotificationService`:

1. Request không đi thẳng — đi qua sidecar proxy của AppointmentSvc trước.
2. Sidecar xử lý retry, timeout, circuit breaker theo config trung tâm.
3. Request đến sidecar của NotificationSvc, được decrypt (mTLS), rồi mới vào service thật.

Spring Boot không biết gì về chuyện này. Nó nghĩ mình đang gọi HTTP bình thường.

---

## Control plane vs Data plane

Service mesh có hai phần tách biệt:

**Data plane** — là các sidecar proxy (thường là Envoy). Proxy này intercept traffic thực tế, apply policy, collect metrics. Chạy phân tán, một instance mỗi pod.

**Control plane** — là "não" của mesh. Operator cấu hình policy ở đây: "tất cả call giữa service phải có mTLS", "retry tối đa 3 lần với 500ms jitter", "route 10% traffic sang v2 của NotificationService". Control plane đẩy config xuống từng data plane.

Trong Istio (service mesh phổ biến nhất hiện tại), control plane là `istiod`. Bạn không cấu hình từng Envoy — bạn viết `VirtualService`, `DestinationRule`, `PeerAuthentication` bằng Kubernetes YAML, `istiod` lo phần còn lại.

Ví dụ config retry trong Istio — không phải trong Spring Boot code:

```yaml
# VirtualService: định nghĩa traffic routing và retry policy
apiVersion: networking.istio.io/v1beta1
kind: VirtualService
metadata:
  name: notification-service
spec:
  hosts:
    - notification-service
  http:
    - retries:
        attempts: 3
        perTryTimeout: 2s
        retryOn: "5xx,connect-failure,reset"
      timeout: 10s
      route:
        - destination:
            host: notification-service
            port:
              number: 8080
```

`AppointmentService` gọi `http://notification-service/...` bình thường. Envoy sidecar nhìn thấy YAML này, tự retry theo config. Bạn không viết một dòng retry code nào trong Java.

---

## Những gì service mesh làm

**Observability tự động** — mỗi request giữa service đều được sidecar đo latency, error rate, và record distributed trace (xem bài về distributed tracing). Không cần instrument thủ công trong từng service.

**mTLS tự động** — traffic giữa service được encrypt và authenticate mà không cần bạn viết code TLS. Istio cấp certificate tự động cho từng service identity.

**Traffic shaping** — canary deployment, A/B testing, fault injection (inject 10% artificial error để test resilience). Config bằng YAML, không cần feature flag trong code.

**Circuit breaker và timeout** — như ví dụ trên, không cần Resilience4j trong từng service.

---

## Khi nào KHÔNG nên dùng service mesh

Đây là phần quan trọng nhất bài này.

Service mesh là **infrastructure complexity cực lớn**. Istio có learning curve đáng kể — `VirtualService`, `DestinationRule`, `Gateway`, `PeerAuthentication`, `AuthorizationPolicy`. Debug khi proxy intercept traffic mà không rõ lý do là trải nghiệm đau đớn. Sidecar Envoy tiêu thêm CPU và memory cho mỗi pod.

**Không dùng service mesh khi:**

Bạn có monolith hoặc ít hơn 5 service. Overhead setup Istio cho 3 service là overkill hoàn toàn. Resilience4j trong từng service (bài 139) là đủ.

Team bạn chưa thành thạo Kubernetes. Service mesh chạy trên K8s, nếu K8s còn đang học thì mesh là layer phức tạp không cần thiết ở giai đoạn này.

Bạn chưa có observability cơ bản. Nếu logging còn chưa tử tế (bài 102), tracing còn chưa có — mesh thêm complexity mà không giải quyết vấn đề cấp bách hơn.

**Cân nhắc dùng service mesh khi:**

Có 10+ service giao tiếp với nhau và bắt đầu thấy khó theo dõi traffic flow.

Team có dedicated platform/infra engineer — không phải dev vừa code vừa quản mesh.

Security yêu cầu mTLS bắt buộc giữa service — config manual cho từng pair là không thực tế.

---

## Istio không phải service mesh duy nhất

Linkerd là alternative nhẹ hơn Istio đáng kể — proxy dùng Rust thay Envoy, tiêu ít resource hơn, config đơn giản hơn. Nếu bạn cần mesh nhưng thấy Istio quá nặng, Linkerd là điểm bắt đầu tốt hơn.

Consul Connect của HashiCorp cho môi trường hybrid cloud / không thuần Kubernetes.

HMS ở quy mô startup đến mid-size: Resilience4j trong từng service + distributed tracing (bài sau) là đủ. Service mesh là bài toán của giai đoạn sau khi complexity thực sự warrant nó.

---

## Takeaway

Service mesh không phải upgrade tự động khi có nhiều service. Nó giải quyết vấn đề thật — cross-cutting concerns duplicate ở hàng chục service — nhưng đổi lại bằng infrastructure complexity thật. Bạn cần hiểu vấn đề trước khi chạm vào giải pháp.

---

*Bài tiếp theo: API Gateway vs Load Balancer — một lỗi thường gặp là hai cái này*
