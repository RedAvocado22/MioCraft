---
title: "Postmortem — sau incident, học hệ thống không đổ lỗi người"
description: "On-call đã stabilize (bài 121). Postmortem blameless: timeline, root cause hệ thống, action item có owner — không phải biên bản kỷ luật."
category: programming
pubDate: 2026-05-29
series: "Phần 12: Production & Ops"
tags: ["postmortem", "incident", "production", "on-call"]
---

2 giờ sáng team rollback xong — API ổn, Slack im. Tuần sau manager hỏi: *"Postmortem đâu?"*

Junior nghĩ đó là buổi họp tìm **ai deploy sai**. Senior biết postmortem tìm **hệ thống cho phép deploy sai chui qua** — và sửa guardrail để lần sau khó lặp lại hơn, không phải khó hơn cho một người.

P12/Bài 09 là 15 phút đầu. Postmortem là **48–72 giờ sau**, khi đầu óc đã nguội và log còn đủ retention.

---

## Blameless không có nghĩa là không trách nhiệm

**Blameless** = không attack cá nhân (*"Anh A ngu"*). Vẫn ghi fact: *"Deploy 02:45 thiếu migration expand phase (bài 120)"*. Focus:

- Điều gì **quan sát được** (metric, log `requestId`)
- **Tại sao** process cho phép (thiếu check staging, thiếu integration test payment)
- **Action** thay đổi hệ thống/process

Nếu chỉ kết luận *"cẩn thận hơn"* — postmortem vô nghĩa.

---

## Template ngắn đủ dùng cho HMS

```markdown
# Incident: [tên ngắn] — YYYY-MM-DD

## Summary (2–3 câu)
Symptom, impact (bao nhiêu user/clinic), duration.

## Timeline (UTC hoặc giờ VN, thống nhất)
- 02:45 — Deploy hms-api v1.2.3
- 02:48 — 5xx rate spike dashboard
- 02:52 — On-call rollback
- 03:10 — Stable

## Root cause (technical, một đoạn)
Ví dụ: Flyway thêm NOT NULL column không expand-contract → insert appointment fail.

## Contributing factors
- Staging không replay prod volume
- Alert có nhưng threshold quá cao

## What went well
- Rollback < 10 phút
- Correlation ID truy được request mẫu

## Action items
| Action | Owner | Due |
|--------|-------|-----|
| Thêm integration test cancel+refund | @dev | sprint X |
| Runbook deploy có bước check migration | @ops | |

## Lessons (optional link bài series)
```

Timeline lấy từ channel incident bài 121 — đừng nhớ lại sau một tuần.

---

## Phân biệt symptom vs root cause

- **Symptom:** `NullPointerException` ở `PaymentService`
- **Root cause:** Webhook xử lý trước khi payment row tồn tại — race thiết kế
- **Contributing:** Không test webhook reorder trên staging

Fix symptom (null check) không đủ nếu race vẫn tồn tại.

---

## Ai tham gia

On-call primary viết draft. Thêm: dev touched area, người deploy (để hiểu context, không để "xử"). Product nếu impact user-facing. 30–45 phút meeting hoặc async doc — **doc lưu Confluence/Git**, searchable.

---

## Liên kết series khác

| Incident type | Bài liên quan |
|---------------|----------------|
| Duplicate payment | 84, 116 |
| Notification mất | 115 |
| Deploy cắt request | 119 |
| Data leak deleted | 127 |

Postmortem không thay code — nhưng action item không owner = decoration.

---

## Takeaway

Incident xong → trong 3 ngày có doc timeline + root cause hệ thống + action có owner. Câu hỏi cuối meeting: *"Thay đổi gì để lần sau incident class này khó xảy ra hơn?"* — không phải *"Ai sai?"*

---

*Bài tiếp theo: Staging — môi trường không phải bản nháp vô nghĩa*
