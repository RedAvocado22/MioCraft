---
title: "Lighthouse đang chấm điểm web của mày dựa trên cái gì thật ra?"
description: "Con số 0–100 của Lighthouse không phải cảm tính — nó là weighted average của các metric đo chính xác trải nghiệm người dùng. LCP, INP, CLS, và lý do con số đó ảnh hưởng đến SEO."
category: programming
pubDate: 2026-07-23
series: "Behind the Tech: Frontend"
tags: ["lighthouse", "web-vitals", "performance", "lcp", "cls", "frontend"]
---

Mày chạy Lighthouse, nhận điểm 43. Màu đỏ. Mày sửa vài thứ, điểm lên 71. Màu cam. Mày tiếp tục, lên 91. Màu xanh. Nhưng mày có thực sự biết mình vừa fix cái gì không — hay chỉ đang đoán mò cho đến khi màu đổi?

Vì con số 43 hay 91 không phải do Lighthouse cảm tính. Nó là kết quả của những phép đo rất cụ thể, trên những thứ rất cụ thể, với trọng số rất cụ thể. Và hiểu được chúng thì mày fix đúng chỗ thay vì chạy theo màu sắc.

## Cách naive — tại sao nó không work

Cách đo performance đơn giản nhất: xem trang load xong chưa. Sự kiện `window.onload` — HTML parse xong, CSS parse xong, JS chạy xong, ảnh tải xong. Chờ event đó fire, đo thời gian từ lúc request đến lúc event fire. Số đó thấp thì trang "nhanh".

Vấn đề: `onload` đo thứ browser làm, không đo thứ người dùng *cảm nhận*.

Mày có thể có `onload` rất nhanh nhưng trang nhảy loạn xạ khi font load xong. Mày có thể có trang hiện ra sớm nhưng click vào nút không phản hồi gì cả trong 3 giây. Mày có thể có hero image đẹp nhưng nó load sau cùng, và user nhìn vào một khoảng trắng trong 4 giây đầu.

`onload` không bắt được những điều đó. Lighthouse thì có.

## Cái trick thật sự đằng sau

Lighthouse đo **Core Web Vitals** — bốn metric được thiết kế để phản ánh trải nghiệm người dùng thực tế, không phải hành vi kỹ thuật của browser.

**LCP — Largest Contentful Paint**

Khi nào element lớn nhất trên trang hiện ra xong? "Lớn nhất" theo diện tích pixel: thường là hero image, ảnh sản phẩm, hoặc `<h1>` chính của trang.

```
0ms   → request bắt đầu
800ms → HTML tới (TTFB)
1200ms → CSS parse xong, layout xong
2100ms → hero image tải xong → LCP event!
```

Target: ≤2.5 giây. Đây là metric đo **loading performance** — người dùng cảm thấy trang "có nội dung" khi LCP element hiện ra.

**INP — Interaction to Next Paint**

Sau khi user click, tap, hoặc gõ phím, mất bao lâu để trang *visually* phản hồi? Không chỉ là JavaScript chạy xong — mà là đến khi browser thực sự vẽ lại được frame tiếp theo sau tương tác đó.

INP được đo trên **tất cả tương tác** trong suốt session, lấy percentile 98th (không lấy worst case, không lấy average). Target: ≤200ms. INP thay thế FID (First Input Delay) từ tháng 3/2024 — FID chỉ đo tương tác đầu tiên, còn INP đo toàn bộ session.

**CLS — Cumulative Layout Shift**

Các element có nhảy lung tung khi trang load không? Mỗi khi một element dịch chuyển không phải do user action, CLS tăng. Tổng cộng tất cả shift trong suốt vòng đời trang.

Target: ≤0.1. Đây là metric đo **visual stability** — cảm giác trang "ổn định" hay cứ bị giật.

**TTFB — Time to First Byte**

Từ lúc request gửi đi đến lúc byte đầu tiên của response về. Đây là metric ở tầng server/network — DNS lookup + TCP handshake + TLS + server processing + byte đầu tiên. Target: ≤800ms.

Sơ đồ timeline:

```
REQUEST                                             
─────────────────────────────────────────────────→ thời gian
|         |              |          |
TTFB     FCP            LCP        TTI
(server) (có gì đó)  (nội dung  (interactive)
                      chính)
                                ↑
                      CLS tích lũy trong suốt khoảng này
                      INP đo mọi tương tác sau TTI
```

## Đi sâu hơn — chi tiết kỹ thuật

**Trọng số trong Lighthouse score:**

Lighthouse không lấy trung bình cộng các metric. Nó dùng weighted average:

| Metric | Trọng số |
|--------|----------|
| LCP    | 25%      |
| INP    | 10%      |
| CLS    | 15%      |
| FCP    | 10%      |
| TBT (Total Blocking Time) | 30% |
| Speed Index | 10% |

TBT — Total Blocking Time — chiếm nhiều nhất: 30%. Đây là tổng thời gian main thread bị block bởi long tasks (>50ms). INP cao thường đi kèm TBT cao. Muốn điểm cao, đây là chỗ đáng focus.

**CLS và cái bẫy không ai để ý**

CLS score được tính theo công thức:

```
layout shift score = impact fraction × distance fraction
```

`impact fraction` là % viewport bị ảnh hưởng bởi shift. `distance fraction` là % viewport element đã di chuyển.

Cái bẫy phổ biến nhất: ảnh và video không có `width`/`height` attribute.

```html
<!-- Gây CLS -->
<img src="hero.jpg">

<!-- Không gây CLS -->
<img src="hero.jpg" width="1200" height="600">
```

Khi không có dimensions, browser không biết trước ảnh sẽ to cỡ nào → không reserve space → ảnh tải xong → toàn bộ text phía dưới bị đẩy xuống → CLS tăng vọt. Với `width`/`height`, browser tính được aspect ratio và reserve đúng space từ đầu.

Font cũng gây CLS: system font render trước, web font tải sau, khi swap xong text nhảy vì font metrics khác nhau. Fix: `font-display: optional` (không swap), hoặc `font-display: swap` kết hợp `size-adjust` để minimize shift.

**Lab data vs Field data — sự khác biệt quan trọng**

Lighthouse chạy trong một Chrome tab được kiểm soát — throttled network (Slow 4G), throttled CPU (4x slowdown), không cache, không extension. Đây là **lab data** — reproducible, nhưng không phải thực tế của user.

**Field data** là dữ liệu thực từ Chrome User Experience Report (CrUX) — tổng hợp từ triệu triệu người dùng Chrome thực tế, opt-in. Google Search Console hiển thị field data của site mày.

**Google dùng field data cho ranking** — không phải Lighthouse score. Mày có thể đạt 100 điểm Lighthouse trong lab nhưng vẫn bị penalize trong search nếu field data kém (ví dụ server chậm ở Việt Nam, user thực tế có TTFB 2 giây dù lab đo 200ms).

Lab và field data nên được đọc song song: lab để debug và iterate nhanh, field để biết user thực tế trải nghiệm gì.

**INP và main thread**

INP cao thường có một trong hai nguyên nhân:

1. **Input delay**: event handler không chạy ngay vì main thread đang bận (long task đang chạy)
2. **Processing time**: event handler chạy quá lâu
3. **Presentation delay**: sau khi JS chạy xong, browser mất quá lâu để render frame mới

Công cụ để debug: Performance tab trong DevTools, tìm các "long tasks" (màu đỏ trên main thread), và "Interactions" track để xem từng tương tác mất bao lâu từng phase.

## Mày thấy nó ở đâu trong thực tế

**PageSpeed Insights** (pagespeed.web.dev) kết hợp cả lab data (Lighthouse) và field data (CrUX) vào một trang. Đây là thứ mày nên xem thay vì chỉ chạy Lighthouse local — vì nó cho mày cả hai perspective.

**Search Console** > Core Web Vitals report cho mày thấy URL nào đang fail, fail theo metric nào, và nhóm URLs có pattern giống nhau. Đây là chỗ mày prioritize việc fix — không phải fix trang random, mà fix trang nhiều traffic nhất đang fail LCP hay CLS.

Một số pattern cố định thường gặp:

- **LCP chậm**: ảnh hero không được preload (`<link rel="preload">`), nằm trong lazy-loaded component, hoặc ảnh quá nặng
- **CLS cao**: ảnh thiếu dimensions, ads inject vào trên nội dung, font swap
- **INP cao**: React re-render không cần thiết, heavy computation trong event handler, third-party scripts chiếm main thread

## Một dòng để nhớ

Lighthouse không đo trang của mày nhanh đến đâu — nó đo người dùng *cảm thấy* trang của mày nhanh đến đâu.

---
*Bài tiếp theo: Tại sao TikTok biết mày thích xem gì chỉ sau vài video?*
