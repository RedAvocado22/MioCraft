---
title: "Staging — môi trường không phải bản nháp vô nghĩa"
description: "Staging mirror prod về topology và config shape — data masked, secret riêng, gateway sandbox. Integration test 103 fail vì staging khác local, không phải vì test dở."
category: programming
pubDate: 2026-05-29
series: "Phần 12: Production & Ops"
tags: ["staging", "deployment", "environment", "testing"]
---

*"Trên máy em chạy được."* — rồi merge, CI xanh, production đỏ.

Thường không phải vì prod ma quái. **Staging (và local) không giống prod đủ chỗ quan trọng** — Keycloak realm khác tên, Redis không cluster, payment trỏ sandbox nhưng webhook URL vẫn localhost từ tuần trước.

Staging không phải nơi "cho chạy được". Là **rehearsal** trước khi khách thật đụng.

---

## Staging khác local và prod thế nào

| | Local | Staging | Prod |
|--|-------|---------|------|
| Data | Seed nhỏ / fake | Copy prod **masked** hoặc synthetic gần thật | Thật |
| Secrets | `.env` dev | Vault/staging keys | Vault/prod keys |
| External | Mock hoặc sandbox | **Sandbox** gateway, Keycloak staging realm | Live |
| Scale | 1 instance | ≥2 pod (nếu prod ≥2) | Production |

Mục tiêu staging: bắt lỗi **integration** (bài 103) — Flyway migration lock, CORS domain thật, webhook signature URL public.

---

## Config cùng shape, khác value

Spring profiles (bài 105):

```yaml
# application-staging.yml — CÙNG keys với prod, khác value
spring:
  datasource:
    url: jdbc:mysql://staging-db.internal/hms
payment:
  webhook-base-url: https://api-staging.hms.example.com
  gateway:
    api-key: ${PAYMENT_SANDBOX_KEY}
keycloak:
  realm: hms-staging
```

**Đừng** thêm key chỉ có trên staging rồi quên port sang prod — Spring fail to start với `IllegalArgumentException: Could not resolve placeholder` lúc 2 giờ sáng.

Cùng **Docker image** tag deploy staging và prod; chỉ đổi env mount (bài 105).

---

## Data: masked, không dump thẳng PHI

Healthcare: không copy bảng `patient` prod → staging nguyên xi. Pipeline:

- Anonymize email/phone
- Hoặc synthetic dataset đủ volume test pagination (bài 100)

Migration Flyway (bài 99) chạy staging **trước** prod window — estimate lock time (bài 120).

---

## Webhook và callback phải reachable

Payment sandbox gọi webhook — URL phải là `https://api-staging...`, không `http://127.0.0.1`. Tunnel (ngrok) chỉ cho dev cá nhân; team dùng staging DNS cố định.

Test checklist trước release:

1. Book appointment E2E staging  
2. Webhook `SUCCESS` → appointment `CONFIRMED` (116)  
3. Cancel + refund job (123)  
4. Rate limit book (122) không 429 oan read API  

---

## Staging không thay prod monitoring

Log format JSON + `requestId` giống prod (102). Alert có thể nhẹ hơn nhưng **cùng dashboard structure** — on-call quen mắt khi incident thật.

---

## Khi staging "quá đắt"

Không có staging full → tối thiểu:

- Ephemeral preview env per PR (schema migrate, smoke test)
- Contract test với gateway mock
- Không được bỏ hẳn rồi pray trên prod

---

## Takeaway

Trước merge lớn: hỏi *"Deploy lên staging với cùng image + profile shape prod chưa?"* — và chạy một flow có webhook + refund. Staging giống prod về **hình**, khác về **data và secret** — không phải bản local đặt trên server rẻ hơn.

---

*Bài tiếp theo: Retry outbound và idempotency — khi HMS gọi gateway, không phải ngược lại*
