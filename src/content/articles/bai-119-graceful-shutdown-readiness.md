---
title: "Graceful shutdown và readiness probe — deploy không cắt giữa request"
description: "SIGTERM, server.shutdown=graceful, readiness fail khi DB down — K8s không route traffic vào pod đang chết."
category: programming
pubDate: 2026-06-06
series: "Phần 12: Production & Ops"
tags: ["production", "kubernetes", "health", "deploy"]
---


Deploy lúc cao điểm đặt lịch. User bấm "Xác nhận" — spinner quay, rồi timeout. Pod cũ vừa nhận `SIGTERM`, Tomcat cắt connection giữa chừng. Transaction appointment **rollback** hoặc **commit xong nhưng client không nhận response** — user bấm lại, duplicate risk (cần idempotency bài 84).

Healthy deploy không chỉ "image mới chạy được". Còn là **pod cũ thoát êm**.

---

## SIGTERM và graceful period

Kubernetes terminate pod: `SIGTERM` → chờ `terminationGracePeriodSeconds` (mặc định 30s) → `SIGKILL`.

Spring Boot 2.3+:

```yaml
server:
  shutdown: graceful

spring:
  lifecycle:
    timeout-per-shutdown-phase: 30s
```

Graceful shutdown:

1. Ngừng nhận request mới (load balancer / K8s remove từ endpoints)
2. Chờ request đang chạy hoàn thành (trong timeout)
3. Đóng connection pool

```java
// PreStop hook K8s — optional, cho LB propagate
// sleep 5s trước SIGTERM để endpoint list cập nhật
```

---

## Readiness vs Liveness

| Probe | Câu hỏi | Fail thì |
|-------|---------|----------|
| **Liveness** | Process còn sống? | Restart pod |
| **Readiness** | Có nhận traffic không? | Remove khỏi Service, không restart |

```java
@Component
public class ReadinessHealthIndicator implements HealthIndicator {

  private final DataSource dataSource;
  private final RedisConnectionFactory redis;

  @Override
  public Health health() {
    try (var conn = dataSource.getConnection();
         var redisConn = redis.getConnection()) {
      conn.isValid(2);
      redisConn.ping();
      return Health.up().build();
    } catch (Exception ex) {
      return Health.down().withException(ex).build();
    }
  }
}
```

```yaml
# application.yml — Actuator
management:
  endpoint:
    health:
      probes:
        enabled: true
  health:
    livenessstate:
      enabled: true
    readinessstate:
      enabled: true
```

K8s:

```yaml
readinessProbe:
  httpGet:
    path: /actuator/health/readiness
    port: 8080
  periodSeconds: 5
livenessProbe:
  httpGet:
    path: /actuator/health/liveness
    port: 8080
```

DB maintenance — readiness **down** → traffic chuyển pod khác, không gửi request vào pod sắp fail từng query.

**Đừng** check DB nặng mỗi giây trên liveness — DB blip restart toàn bộ pod = thundering herd.

---

## Deploy sequence thực tế

1. Pod mới **readiness up** (DB OK, migration xong)
2. K8s add vào endpoints
3. Pod cũ **SIGTERM**, graceful drain
4. Pod cũ exit

Rolling update `maxUnavailable: 0` giữ capacity trong lúc swap.

---

## Job dài và shutdown

`@Async` hoặc batch export PDF — nếu vượt grace period, bị kill giữa chừng. Đánh dấu job `RUNNING` trong DB, worker khác resume, hoặc tăng grace / drain job trước deploy.

Outbox worker (bài 115): transaction ngắn — ít risk hơn report generation 10 phút.

---

## Local dev vs prod

Dev `Ctrl+C` cũng trigger shutdown — test graceful trước khi tin prod. `kubectl delete pod` với grace period thấp để simulate.

---

## Takeaway

Production deploy: bật `server.shutdown=graceful`, readiness phản ánh DB/Redis thật, liveness nhẹ. Pod terminate không phải instant kill switch cho user đang book lịch. Và nếu timeout spike đúng deploy window — xem grace period và preStop trước khi blame code mới.

---

*Bài tiếp theo: Migration zero-downtime — expand-contract.*
