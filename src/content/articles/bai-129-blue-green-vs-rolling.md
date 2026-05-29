---
title: "Blue-green vs rolling deploy — khi nào dùng cái nào"
description: "Rolling update mặc định trên K8s, blue-green đổi traffic một phát, và vì sao zero-downtime không có nghĩa zero-risk."
category: programming
pubDate: 2026-05-30
series: "Phần 12: Production & Ops"
tags: ["production", "deploy", "kubernetes", "zero-downtime"]
---

Deploy HMS lúc 14h — bệnh nhân vẫn đặt lịch. Không banner “bảo trì”. Đó là kỳ vọng **zero-downtime**: không có khoảng thời gian API trả 502 hàng loạt.

Nhưng “không downtime” không đồng nghĩa “không rủi ro”. Hai chiến lược phổ biến — **rolling** và **blue-green** — trade-off khác nhau. Junior hay gọi nhầm cả hai là “deploy K8s”.

---

## Rolling deploy — thay từng pod, dần dần

Kubernetes `Deployment` mặc định dùng **RollingUpdate**: pod cũ terminate, pod mới lên, lặp cho đến hết replica.

```yaml
spec:
  strategy:
    type: RollingUpdate
    rollingUpdate:
      maxUnavailable: 0   # luôn đủ pod nhận traffic
      maxSurge: 1         # tạm thêm 1 pod mới trước khi kill cũ
```

**Ưu:** Đơn giản, không cần gấp đôi tài nguyên lâu dài. Phù hợp deploy hàng ngày, patch nhỏ.

**Nhược:** Trong vài phút, **cả version cũ và mới cùng chạy**. Client có thể hit pod cũ rồi pod mới — schema/API phải **backward compatible** (expand-contract, bài 120). Nếu version mới có bug, một phần user đã dính trước khi mày rollback xong.

Rolling không thay thế **graceful shutdown** (bài 119): pod cũ vẫn phải xử lý xong request đang chạy trước khi chết.

---

## Blue-green — hai “màu”, đổi traffic một lần

**Blue** = prod hiện tại. **Green** = bản mới deploy song song, chưa nhận user traffic.

Flow:

1. Deploy green (cùng DB/schema đã compatible)
2. Smoke test green (health, readiness, vài API critical)
3. Load balancer / Ingress **switch 100%** blue → green
4. Giữ blue vài phút để rollback nhanh nếu cần, rồi tắt

**Ưu:** Cutover rõ ràng — không có mix hai version phía user (nếu LB đúng). Rollback = switch lại blue, thường nhanh hơn redeploy.

**Nhược:** Cần **đủ capacity** chạy hai stack (hoặc scale tạm). Migration DB phải tương thích **cả hai** app trong cửa sổ chuyển đổi. Không phải lúc nào cũng đáng cho team nhỏ chạy monolith một service.

Trên K8s, blue-green thường là **hai Deployment + Service selector đổi**, hoặc Argo Rollouts / Flagger — không phải magic built-in một dòng.

---

## Khi nào chọn cái nào

| Tình huống | Gợi ý |
|------------|--------|
| Deploy nhỏ, nhiều lần/ngày, API backward compatible | Rolling (mặc định) |
| Release lớn, sợ mix version, cần rollback tức thì | Blue-green (hoặc canary) |
| DB migration breaking | **Không** deploy kiểu “đổi một phát” — expand-contract trước |
| Chỉ một replica, tài nguyên chật | Rolling với `maxUnavailable: 0`; blue-green khó vì cần surge |

**Canary** (liên quan): đưa 5% traffic sang version mới, quan sát metric, rồi tăng dần — giữa rolling và blue-green về mức rủi ro. Hay đi với feature flag (bài 128).

---

## Zero-downtime ≠ zero incident

Pod mới **CrashLoopBackOff** mà rolling vẫn “thành công” một phần — traffic có thể về pod lỗi nếu readiness probe sai. Blue-green mà smoke test hời hợt — switch xong mới thấy payment webhook fail.

Checklist ngắn trước deploy lớn:

- Readiness gồm DB + Redis (bài 119)
- Migration Flyway chạy **trước** app mới (backward compatible)
- Có cách rollback **đã thử** trên staging

---

## Takeaway

Hàng ngày: rolling + graceful shutdown đủ cho HMS monolith. Release rủi ro cao hoặc cần rollback tức thì: cân nhắc blue-green/canary — và nhớ chi phí tài ngốn + schema hai phía. Đừng gọi rolling là “an toàn 100%” khi vẫn có hai version cùng sống.

---

*Bài tiếp theo: Alert design — đúng alert, không phải nhiều alert*
