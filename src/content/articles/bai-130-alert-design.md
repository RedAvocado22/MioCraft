---
title: "Alert design — on-call không chết vì noise"
description: "Alert phải báo user đang đau, có hành động rõ, và page ít — không phải mọi log ERROR đều ping Slack lúc 3h sáng."
category: programming
pubDate: 2026-05-31
series: "Phần 12: Production & Ops"
tags: ["production", "on-call", "observability", "sre"]
---

Tuần đầu on-call, người mới nhận 40 Slack ping/đêm. Sáng hôm sau team thấy “alert fatigue”: mọi người mute channel, bỏ qua ping thật lẫn ping giả. Incident thật — payment webhook fail — chôn trong *“CPU > 70% trên pod staging”*.

Vấn đề không phải thiếu monitoring. Là **alert sai**.

---

## Alert đúng = symptom + actionable + ít người bị đánh thức

Một alert tốt trả lời được:

1. **User có đang đau không?** (5xx rate, booking fail, queue backlog — không phải “disk 65%”)
2. **Ai cần làm gì ngay?** (runbook bước 1–3, không chỉ “check Grafana”)
3. **Có cần page lúc 3h không?** (nếu sáng mai xử lý được → ticket, không page)

```text
❌ Alert: JVM heap > 80% trên mọi pod
   → Spike traffic bình thường, auto GC, user không thấy gì — noise

✅ Alert: rate(http_5xx)[5m] > 2% AND duration > 3m
   → Bệnh nhân không đặt được lịch — page on-call
```

**Symptom-based**, không **cause-based** sớm: đừng alert “Redis connection pool 9/10” trừ khi đã chứng minh nó luôn dẫn tới timeout API. Đôi khi pool cao vì traffic cao nhưng hệ vẫn khỏe.

---

## Severity và routing

| Mức | Ý nghĩa | Ví dụ HMS |
|-----|---------|-----------|
| **P1 / page** | Mất chức năng core, cần người trong vài phút | API booking 5xx hàng loạt, DB primary down |
| **P2 / Slack urgent** | Degraded, workaround có | Search chậm, email delay > 15 phút |
| **P3 / ticket** | Cần fix, không gấp đêm | Staging disk, dependency minor version EOL |

Một rule team hay dùng: **nếu alert fire mà on-call không có hành động cụ thể trong 15 phút → alert đó nên là ticket hoặc bị tắt/sửa ngưỡng**.

---

## Tránh alert trùng và flap

Ba alert cùng một sự cố = ba ping, một incident:

- `Pod not ready`
- `5xx rate high`
- `Latency p99 high`

Gom **một alert symptom** gốc (vd: SLO booking success rate), dùng dashboard drill-down cho nguyên nhân (bài 121).

**Flapping** — alert on/off mỗi 2 phút — giết niềm tin. Dùng `for: 5m` (Prometheus) hoặc hysteresis: chỉ fire khi vượt ngưỡng **liên tục** N phút.

---

## Runbook một dòng trong alert

```text
Alert: HMS API 5xx > 2% (5m)
Runbook: https://wiki/.../api-5xx
1. Grafana dashboard "HMS Overview" — endpoint nào?
2. Deploy trong 30 phút? → consider rollback (bài 129)
3. Correlation ID mẫu: grep prod log (bài 121)
Escalate: #hms-oncall → DBA nếu DB connection refused
```

Người mới lúc 3h sáng không cần nhớ hết — cần **bước đầu không làm tệ hơn** (đừng restart all pods trước khi biết phạm vi).

---

## Alert review định kỳ

Mỗi quý (hoặc sau incident):

- Alert nào **không ai action** trong 3 tháng? → xóa hoặc hạ severity
- Alert nào **luôn false positive** giờ cao điểm? → tune ngưỡng hoặc exclude staging
- Thiếu alert nào incident cho thấy phát hiện muộn? → thêm **một** symptom alert, không clone 10 cái

On-call rotation chỉ bền khi **tin** vào ping.

---

## Takeaway

Trước khi thêm alert mới: viết câu “user đau thế nào” và “on-call làm bước gì trong 15 phút”. Nếu trả lời mơ hồ — để dashboard, không page. Mục tiêu là ít alert **đáng tin**, không nhiều alert **đáng sợ**.

---

*Bài tiếp theo: API versioning — URL /v1/ vs header và deprecation*
