---
title: "Tại sao ảnh trên web hiện đại nhỏ hơn nhưng vẫn đẹp?"
description: "Cùng một ảnh, WebP nhỏ hơn JPEG 30%, AVIF nhỏ hơn 50% — mà mắt người không phân biệt được. Đây là ba lớp kỹ thuật làm cho web năm 2024 load nhanh hơn mà không mờ hơn."
category: programming
pubDate: 2026-07-20
series: "Behind the Tech: Frontend"
tags: ["performance", "images", "webp", "avif", "web-vitals", "frontend"]
---

Mày mở một trang tin tức, có chục ảnh chất lượng cao, trang load trong 2 giây. Mày inspect network tab, thấy mỗi ảnh chỉ nặng 80-150KB. Nhưng nhìn trên màn hình Retina, ảnh vẫn sắc nét.

Rồi mày vào một trang cũ hơn — ảnh JPEG nguyên gốc, 600-800KB mỗi cái, trang load 8 giây, ảnh trông không đẹp hơn gì. Cùng nội dung, cùng màn hình — tại sao file size lại khác nhau đến vậy? Và tại sao chuyển sang format mới lại không làm ảnh xấu đi?

## Cách naive — tại sao nó không work

Cách làm truyền thống: export ảnh ra JPEG, đặt chất lượng 80%, upload lên server, dùng một URL cho tất cả thiết bị.

```html
<!-- Cách cũ -->
<img src="/images/hero.jpg" width="1200" height="630">
```

Vấn đề chồng chất:

**Format JPEG già cỗi:** JPEG ra đời năm 1992. Thuật toán nén của nó — DCT (Discrete Cosine Transform) trên block 8x8 pixel — là state-of-the-art của thập niên 90. Ba mươi năm sau, compression algorithms tiến hóa xa hơn nhiều nhưng JPEG vẫn là default.

**Một size cho tất cả:** Điện thoại 400px width nhận cùng ảnh 1200px như desktop. Browser scale xuống — nhưng mày đã download toàn bộ 1200px, tốn bandwidth cho pixel không ai thấy.

**Load tất cả cùng lúc:** Ảnh ở footer — người dùng có thể không bao giờ scroll xuống đến — vẫn được download ngay khi trang load.

Kết quả: trang 5MB, Lighthouse score đỏ, người dùng mobile bỏ đi sau 3 giây.

## Cái trick thật sự đằng sau

Không có một magic trick. Có ba lớp kỹ thuật, mỗi lớp giải quyết một vấn đề riêng — và chúng hoạt động cùng nhau.

**Lớp 1: Format hiện đại — nén tốt hơn, cùng chất lượng**

Browser gửi `Accept` header khi request ảnh:

```
Accept: image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8
```

Server (hoặc CDN) đọc header này, trả về format tốt nhất browser hỗ trợ:

```
JPEG:  300 KB  ← baseline
WebP:  195 KB  ← 35% nhỏ hơn, cùng quality
AVIF:  140 KB  ← 53% nhỏ hơn, cùng quality
```

Mày không thấy sự khác biệt bằng mắt. Nhưng file nhỏ hơn gần một nửa.

**Lớp 2: Responsive images — đúng size cho đúng thiết bị**

```html
<img
  srcset="
    /img/hero-400.webp  400w,
    /img/hero-800.webp  800w,
    /img/hero-1600.webp 1600w
  "
  sizes="(max-width: 600px) 400px, (max-width: 1200px) 800px, 1600px"
  src="/img/hero-800.webp"
  alt="Hero image"
>
```

Browser tính: màn hình rộng bao nhiêu? Device pixel ratio là bao nhiêu (Retina = 2x)? Rồi chọn ảnh phù hợp từ `srcset`.

Điện thoại 400px width, DPR 2x → cần ảnh 800px → load `hero-800.webp`. Không load `hero-1600.webp` 4x to hơn mà không ai thấy thêm detail.

**Lớp 3: Lazy loading — chỉ load khi cần**

```html
<img src="/img/footer-photo.webp" loading="lazy" alt="...">
```

Một attribute, giảm initial page load đáng kể. Browser chỉ download ảnh khi nó sắp vào viewport — khoảng 200-500px trước khi scroll đến.

## Đi sâu hơn — chi tiết kỹ thuật

**Tại sao WebP nhỏ hơn JPEG?**

JPEG dùng DCT trên block 8x8 — transform pixel sang frequency domain, discard high-frequency (fine detail) data theo quality setting. Block-based approach tạo ra "ringing artifacts" ở cạnh sắc và "blocking artifacts" ở quality thấp.

WebP dùng **block prediction** từ VP8 video codec: thay vì transform độc lập từng block, nó **predict** giá trị của block dựa trên các block xung quanh, sau đó chỉ encode **residual** (sai số giữa prediction và thực tế). Residual nhỏ hơn nhiều so với giá trị gốc → nén được nhiều hơn. WebP cũng hỗ trợ transparency (alpha channel) mà JPEG không có.

**Tại sao AVIF nhỏ hơn nữa?**

AVIF dựa trên **AV1** — codec video thế hệ mới (2018) của Alliance for Open Media, bao gồm Google, Netflix, Apple, Mozilla. AV1 dùng:

- **Larger block sizes**: lên đến 128x128 thay vì 8x8 của JPEG. Block to hơn = predict tốt hơn cho vùng phẳng màu.
- **More prediction modes**: AVIF có hàng chục directional prediction modes thay vì vài mode của JPEG.
- **Better entropy coding**: ANS (Asymmetric Numeral Systems) thay vì Huffman coding — encode bit hiệu quả hơn.

Nhược điểm: encode AVIF **chậm hơn nhiều** so với WebP hay JPEG. Đây là lý do người ta thường encode AVIF offline, không on-the-fly.

**CDN image transformation** — thứ làm tất cả vận hành trong thực tế:

```
Upload một lần:  original.jpg (5MB, 4000x3000px)

Cloudflare Images / Imgix / Cloudinary:
  Nhận request: /img/hero?w=800&format=webp&q=80
  → Resize xuống 800px
  → Convert sang WebP
  → Quality 80
  → Cache result
  → Serve 120KB
```

Mày không cần tạo thủ công 10 phiên bản của mỗi ảnh. CDN làm điều đó on-the-fly lần đầu, cache cho lần sau.

**`<picture>` element** cho full control:

```html
<picture>
  <source type="image/avif" srcset="/img/hero.avif">
  <source type="image/webp" srcset="/img/hero.webp">
  <img src="/img/hero.jpg" alt="Fallback for old browsers">
</picture>
```

Browser thử từ trên xuống — AVIF trước, WebP nếu không support, JPEG làm fallback. IE11 và browser cổ lấy JPEG. Chrome/Firefox hiện đại lấy AVIF.

**IntersectionObserver** — cơ chế đằng sau `loading="lazy"`:

```javascript
const observer = new IntersectionObserver((entries) => {
  entries.forEach(entry => {
    if (entry.isIntersecting) {
      const img = entry.target;
      img.src = img.dataset.src;  // thật sự load ảnh
      observer.unobserve(img);
    }
  });
}, { rootMargin: "200px" });  // bắt đầu load khi còn 200px trước khi vào viewport

document.querySelectorAll('img[data-src]').forEach(img => observer.observe(img));
```

`loading="lazy"` native làm điều tương tự, được browser implement trực tiếp ở C++ — nhanh hơn JavaScript và không cần library.

## Mày thấy nó ở đâu trong thực tế

**Next.js Image component** wrap tất cả ba kỹ thuật này: tự động serve WebP/AVIF, generate srcset, lazy load mặc định. Một dòng `<Image src="..." />` thay thế cả đống boilerplate.

**Shopify** convert tất cả merchant images sang WebP/AVIF tự động. Đây là lý do product images trên Shopify store load nhanh dù seller upload JPEG to.

**Instagram và Twitter/X** transcode tất cả ảnh upload về WEBP/AVIF, serve qua CDN với multiple resolutions. Ảnh 10MB mày upload → họ giữ original nhưng serve compressed version phù hợp với device của người xem.

**Lighthouse "Serve images in next-gen formats"** và **"Properly size images"** là hai audit hay bị đỏ nhất trên web hiện tại — và cũng là hai cái dễ fix nhất nếu mày biết cơ chế đằng sau.

Browser support hiện tại (2025): WebP — 97% users. AVIF — 93% users. Cả hai an toàn để dùng với JPEG/PNG fallback.

## Một dòng để nhớ

Ảnh không nhỏ hơn vì mày chấp nhận chất lượng thấp hơn — mà vì codec mới dùng toán học tốt hơn để encode cùng thông tin vào ít bit hơn.

---
*Bài tiếp theo: Tại sao bundle JavaScript được split nhỏ thay vì một file khổng lồ?*
