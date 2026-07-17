---
title: "On-call — 15 phút đầu đọc log production"
description: "Alert 5xx spike: correlation ID, timeline, thay đổi gần đây — trước khi grep exception ngẫu nhiên. Checklist cho lần đầu vào on-call rotation."
category: programming
pubDate: 2026-06-08
series: "Phần 12: Production & Ops"
tags: ["production", "on-call", "logging", "incident"]
---


3 giờ sáng Slack ping: *"HMS API lỗi"*. Người mới SSH vào server, `tail -f` file log, thấy wall of stacktrace, panic restart pod — không hỏi **khi nào bắt đầu**, **bao nhiêu % request**, **deploy gì lúc 2:50**.

15 phút đầu quyết định bạn đang debug hay đang làm tệ hơn.

---

## Phút 0–3: Xác nhận phạm vi

Trả lời nhanh bằng metric/dashboard (hoặc log aggregate):

- **Symptom:** 500? 403 hàng loạt? Chậm (p95 latency)? Một endpoint hay toàn API?
- **Since when:** alert fire lúc nào — correlate deploy, migration Flyway, Keycloak maintenance
- **Who affected:** tất cả clinic hay một tenant/region

```text
Grafana: rate(http_server_requests_seconds_count{status="500"}[5m])
         spike 02:48 — deploy 02:45?
```

Nếu chỉ `/api/appointments` — đừng restart Redis chưa liên quan.

---

## Phút 3–8: Một request điển hình

Dùng **correlation ID** (bài 102). User báo "đặt lịch lỗi" — lấy `X-Request-Id` từ response hoặc approximate time + `userId`:

```text
grep "requestId=7f3a2b1c" /var/log/hms-api/*.log
```

Chuỗi log một request:

```text
02:49:01.123 INFO  POST /api/appointments requestId=7f3a...
02:49:01.456 DEBUG JDBC appointment insert
02:49:02.789 ERROR PaymentGateway timeout requestId=7f3a...
02:49:02.790 WARN  Rolled back transaction
```

Một dòng ERROR có context — hơn 500 dòng stacktrace không `requestId`.

Structured log (JSON):

```json
{"level":"ERROR","requestId":"7f3a","appointmentId":"...","msg":"Payment gateway timeout","durationMs":3001}
```

---

## Phút 8–12: Thay đổi gần đây

Checklist cố định:

1. Deploy app version — Git SHA, image tag  
2. Flyway migration vừa chạy — lock table? column mới?  
3. Config/env đổi — Keycloak URL, Redis password rotate  
4. Traffic bất thường — campaign, bot scan  
5. Dependency — payment sandbox down, DB failover  

```bash
kubectl rollout history deployment/hms-api
# migration: SELECT * FROM flyway_schema_history ORDER BY installed_rank DESC LIMIT 5;
```

Nếu spike trùng deploy 3 phút — **rollback hoặc forward fix** cân nhắc trước khi đào sâu business logic cũ.

---

## Phút 12–15: Hành động an toàn

| Tình huống | Việc nên làm |
|------------|----------------|
| 5xx 100% sau deploy | Rollback pod trước, investigate sau |
| DB connection exhausted | Scale không fix leak — check pool, long transaction |
| Một dependency timeout | Circuit breaker / tắt feature flag tạm |
| Không chắc | Communicate "đang investigate", chưa restart hàng loạt |

**Đừng** `git revert` production chưa hiểu. **Đừng** xóa data "cho nhanh".

Ghi timeline vào channel incident — sau này postmortem (không đổ lỗi cá nhân, tìm system fix).

---

## Sau khi stabilize

- Root cause một câu  
- Action: test thiếu gì, alert threshold, runbook update  
- Nếu data sai — có cần backfill appointment (bài 115, 116 territory)

---

## Chuẩn bị trước khi vào rotation

- Quyền read log/metric staging mirror prod  
- Biết link dashboard, runbook "API down"  
- Biết ai escalate (DBA, Keycloak admin)  
- Local reproduce với `requestId` format giống prod  

On-call không phải hero debug 4 tiếng một mình — là **giảm blast radius trong 15 phút đầu**.

---

## Takeaway

Alert fire → phạm vi + thời điểm → một `requestId` xuyên suốt → deploy/migration gần nhất → hành động có kiểm soát. `tail` không lọc là chậm. Và restart all pods là nút cuối, không phải bước đầu.

---

*Bài tiếp theo: (tiếp Phần 12 hoặc case study HMS mới)*
