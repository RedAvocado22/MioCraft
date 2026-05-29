---
title: "Tại sao ảnh Instagram load từ mờ đến rõ thay vì hiện trắng rồi bật ra?"
description: "Cái blur nhẹ hiện ra ngay lập tức trước khi ảnh load xong — không phải hiệu ứng cho đẹp. Đó là kết quả của 3 kỹ thuật khác nhau, mỗi cái giải quyết một vấn đề mà cái kia không làm được."
category: system-design
pubDate: 2026-07-02
series: "Behind the Tech: App & UX"
tags: ["performance", "images", "lqip", "progressive-jpeg", "web", "ux"]
---

Lần tới khi mày scroll Instagram trên 4G yếu, để ý kỹ một chút. Ảnh không xuất hiện trắng rồi bật ra — nó hiện ra ngay lập tức, nhưng mờ. Rồi từ từ, trong vài trăm millisecond, nó rõ dần lên. Nếu ảnh chưa load xong, mày vẫn thấy đúng màu sắc chủ đạo, đúng bố cục tổng thể, chỉ là thiếu detail.

Tại sao quan trọng? Vì nếu mày thấy ô trắng, não mày đọc là "đang bị lỗi" hoặc "đang chờ". Còn nếu mày thấy phiên bản mờ của đúng cái ảnh đó, não mày đọc là "đang load thêm chi tiết" — cảm giác hoàn toàn khác nhau, dù network speed giống hệt nhau.

## Cách naive — tại sao nó không work

Cách đơn giản nhất: hiển thị ô màu xám (hoặc trắng) trong khi ảnh full load. Đây là behavior mặc định của browser nếu không làm gì thêm.

Vấn đề thứ nhất là **jarring UX** — khoảng trắng đột ngột bật thành ảnh hoàn chỉnh trông như có gì đó đang bị lỗi. Người dùng không có context về ảnh sắp hiện ra là gì.

Vấn đề thứ hai là **layout shift** — khi ảnh load xong và xuất hiện, nó đẩy các element xung quanh dịch chuyển. Text bên dưới nhảy xuống. Nút bấm di chuyển. Người dùng có thể tap nhầm. Google gọi đây là **Cumulative Layout Shift (CLS)**, một trong những metric quan trọng nhất của Core Web Vitals.

Vấn đề thứ ba: cách naive này **load mọi ảnh ngay khi trang mở** — kể cả những ảnh ở tít dưới cuối trang mà user chưa chắc sẽ scroll tới. Lãng phí bandwidth, lãng phí thời gian.

Ba vấn đề khác nhau → cần ba kỹ thuật khác nhau để giải quyết.

## Cái trick thật sự đằng sau

Không có một giải pháp duy nhất. Instagram (và hầu hết app lớn) dùng **kết hợp nhiều layer**, mỗi layer kick in ở thời điểm khác nhau:

```
Ngay lập tức (0ms):
  └── Dominant color placeholder
      hoặc BlurHash decode (Canvas)

Sau vài ms (khi HTML parse xong):
  └── LQIP (base64 inline) hiển thị

Khi ảnh enter viewport:
  └── IntersectionObserver trigger
      └── Bắt đầu load full image

Khi full image load xong:
  └── Fade in, thay thế placeholder
```

**Layer 1 — Dominant color:** Đơn giản nhất. Server phân tích ảnh gốc và lưu màu chủ đạo (ví dụ: `#3a7bd5`). Client render ngay một ô màu đó — không cần request nào, chỉ là CSS `background-color`. Không đẹp, nhưng đặt được "tông màu" cho ảnh ngay lập tức.

**Layer 2 — LQIP (Low Quality Image Placeholder):** Server tạo ra một phiên bản thu nhỏ của ảnh gốc, khoảng 20×20px, rồi encode nó thành base64 string và nhúng thẳng vào HTML:

```html
<img
  src="data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQ..."
  data-src="https://cdn.instagram.com/full-image.jpg"
/>
```

Cái `data:image/jpeg;base64,...` đó là ảnh 20×20 thật, nặng khoảng 200-500 bytes, được browser render ngay mà không cần HTTP request. CSS `blur()` kéo giãn nó lên kích thước thật, tạo ra hiệu ứng mờ.

**Layer 3 — BlurHash:** Cách tiếp cận khác hẳn. Thay vì lưu một thumbnail, server chạy một thuật toán phân tích ảnh và encode toàn bộ thông tin màu sắc + gradient của ảnh thành một string ~30 ký tự:

```
BlurHash của ảnh hoàng hôn: "LEHV6nWB2yk8pyo0adR*.7kCMdnj"
```

String này được nhúng trong JSON response (không phải trong `<img>`). Client decode nó bằng JavaScript và vẽ lên `<canvas>` — ra một màu blur đẹp, đúng màu sắc của ảnh thật, zero network request. Đây là cách Facebook và Instagram dùng từ khoảng 2018.

**Layer 4 — Progressive JPEG:** Đây là kỹ thuật nằm ở phía encoding của file ảnh gốc, không phải ở code client. JPEG có hai mode lưu trữ:

- **Baseline JPEG:** lưu ảnh từng dòng từ trên xuống dưới. Browser decode từ trên xuống, ảnh hiện dần từ top sang bottom.
- **Progressive JPEG:** lưu ảnh theo nhiều "scan pass". Pass đầu tiên chứa toàn bộ ảnh nhưng với chất lượng rất thấp (shapes, màu chủ đạo). Các pass sau thêm dần detail. Browser render từng pass → ảnh hiện ra mờ rồi rõ dần.

## Đi sâu hơn — chi tiết kỹ thuật

**Lazy loading với IntersectionObserver:**

```javascript
const observer = new IntersectionObserver((entries) => {
  entries.forEach(entry => {
    if (entry.isIntersecting) {
      const img = entry.target;
      img.src = img.dataset.src;  // trigger load ảnh thật
      observer.unobserve(img);
    }
  });
}, { rootMargin: '200px' });  // load trước 200px trước khi vào viewport

document.querySelectorAll('img[data-src]').forEach(img => observer.observe(img));
```

`rootMargin: '200px'` nghĩa là bắt đầu load ảnh khi nó còn cách viewport 200px — đảm bảo ảnh thường load xong trước khi user scroll đến, tạo illusion là "đã có sẵn".

**LQIP size trade-off:** Ảnh thumbnail càng nhỏ thì file size càng nhỏ nhưng blur càng khó nhận ra nội dung. 20×20 là sweet spot thường gặp. Một số site dùng đến 40×40 cho ảnh landscape. Base64 encoding thêm ~33% overhead so với binary, nhưng vẫn rất nhỏ so với ảnh gốc có thể vài MB.

**Fade transition:** Khi ảnh full load xong, đừng swap đột ngột — dùng CSS transition:

```css
.image-placeholder { opacity: 1; filter: blur(20px); transition: opacity 0.3s; }
.image-full.loaded { opacity: 1; }
.image-full { opacity: 0; transition: opacity 0.3s; }
```

**BlurHash vs LQIP:** BlurHash đẹp hơn và không có network request nhưng cần JavaScript để decode. LQIP đơn giản hơn, work ngay cả khi JS chưa chạy. Trong thực tế, các app hybrid dùng BlurHash cho React Native (JS sẵn có), LQIP cho web để đảm bảo no-JS fallback.

## Mày thấy nó ở đâu trong thực tế

**Facebook:** Dùng BlurHash từ 2018, họ là người tạo ra kỹ thuật này. Khi scroll feed trên mạng chậm, mày thấy những blob màu mờ xuất hiện ngay lập tức — đó là BlurHash decode. Đặc biệt rõ ở React Native app.

**Medium:** Dùng LQIP cực kỳ tốt. Khi mày click vào một bài, ảnh header của bài hiện ra ngay (blurry), rồi sharpen lên khi full image load. Medium còn dùng kỹ thuật "color thief" để extract palette của ảnh và set làm background gradient trong khi load.

**Next.js (framework):** Component `<Image>` của Next.js có prop `placeholder="blur"` — nó tự động generate LQIP và handle mọi thứ trên. Đây là lý do các site dùng Next.js thường có image loading experience tốt mà developer không cần làm gì nhiều.

## Một dòng để nhớ

Não người không ngại chờ — nó ngại chờ mà không biết mình đang chờ cái gì; placeholder đúng màu sắc biến "thời gian load" thành "thời gian sharpen".

---
*Bài tiếp theo: Tại sao Google Search gợi ý ngay khi mày gõ mà không lag?*
