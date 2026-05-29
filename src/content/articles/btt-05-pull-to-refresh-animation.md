---
title: "Tại sao kéo refresh trên app mobile có animation mượt — và nó sync với server lúc nào?"
description: "Pull-to-refresh không đợi API xong mới chạy animation. Đây là cách touch events, CSS transform, và optimistic UX phối hợp để tạo cảm giác nhanh dù mạng chậm."
category: system-design
pubDate: 2026-07-06
series: "Behind the Tech: App & UX"
tags: ["mobile", "ux", "animation", "touch-events", "performance"]
---

Mày kéo xuống đầu trang Instagram, thả tay ra — một cái spinner xuất hiện ngay lập tức, xoay vài vòng, rồi content mới nhảy vào. Cả quá trình mượt như bơ. Không giật, không chờ, không màn hình trắng.

Nhưng khoan. Server ở đâu đó cách mày hàng ngàn km. API call mất ít nhất 100–300ms. Vậy cái spinner đó xuất hiện *trước* hay *sau* khi có response từ server? Và nếu animation bắt đầu trước khi có data, làm sao nó biết lúc nào cần dừng lại?

## Cách naive — tại sao nó không work

Cách đơn giản nhất: đợi API trả về xong, rồi mới show spinner, rồi update UI.

```
touchend
  → gọi API
  → đợi response (200ms)
  → hiện spinner
  → update content
  → ẩn spinner
```

Về mặt logic thì đúng. Nhưng trải nghiệm thì tệ. Mày thả tay ra và... không có gì xảy ra trong 200ms. Sau đó spinner mới xuất hiện và ngay lập tức biến mất. Về mặt tâm lý, 200ms delay trước feedback đầu tiên khiến người dùng nghi ngờ cú kéo có được nhận không — và kéo lại lần nữa.

Cách naive thứ hai: chạy animation và API call cùng lúc, nhưng dùng `margin-top` hay `height` để đẩy content xuống khi kéo.

Vấn đề: `margin-top` và `height` trigger **layout reflow**. Mỗi khi mày thay đổi những property này, browser phải tính toán lại vị trí của tất cả elements trên trang. Ở 60fps thì mày có khoảng 16ms mỗi frame. Layout reflow dễ ngốn hết 8–12ms trong số đó. Kết quả: animation lag, giật, tụt xuống dưới 60fps.

## Cái trick thật sự đằng sau

Pull-to-refresh mượt hoạt động dựa trên hai nguyên tắc tách biệt: **animation chạy trên compositor thread**, và **API call fire cùng lúc với touchend** — không phải sau khi có response.

**Phần 1: Touch tracking**

Khi mày đặt ngón tay lên màn hình, trình tự touch events xảy ra:

```
touchstart  → ghi nhận startY
touchmove   → tính deltaY = currentY - startY
              if deltaY > 0 AND scroll position = top:
                  di chuyển content theo ngón tay
touchend    → thả tay, trigger refresh nếu đủ threshold
```

Trong suốt `touchmove`, để di chuyển content mà không gây layout reflow, app dùng `transform: translateY(deltaY)`:

```css
.feed-container {
  transform: translateY(80px);  /* đẩy xuống 80px */
  transition: none;              /* không transition khi đang drag */
}
```

`transform` không ảnh hưởng đến layout — browser composite nó trên GPU, hoàn toàn độc lập với DOM layout. Đây là lý do animation chạy được 60fps ngay cả khi thread chính đang bận.

**Phần 2: Thả tay — đây là lúc mọi thứ xảy ra đồng thời**

```
touchend (deltaY > 60px threshold)
  ├── NGAY LẬP TỨC: bật spinner animation
  ├── NGAY LẬP TỨC: fire API call (async, không await)
  └── NGAY LẬP TỨC: animate content về vị trí "đang refresh"
         └── css transition: transform: translateY(60px) với spring easing
```

```
     Thời gian →
     0ms:   touchend → spinner bật, API fire, content snap về 60px
     16ms:  frame 1 của animation
     ...
     200ms: API response về → update content
     250ms: spinner fade out, content animate vào
```

Spinner xuất hiện ở 0ms. API response đến lúc 200ms. Hai thứ này hoàn toàn không liên quan đến nhau về timing — chúng chạy song song. App chỉ cần đảm bảo spinner *không dừng trước khi có response*, và content *không update trước khi response về*.

**Phần 3: Snap-back animation**

Khi thả tay, content không "rơi" về vị trí cũ theo kiểu linear. Nó dùng CSS transition với cubic-bezier curve giả lập spring physics:

```css
.feed-container {
  transition: transform 400ms cubic-bezier(0.25, 0.46, 0.45, 0.94);
}
```

Easing này — còn gọi là "ease-out" — decelerate nhanh ở cuối, tạo cảm giác có quán tính, giống vật lý thật hơn là animation máy móc.

## Đi sâu hơn — chi tiết kỹ thuật

**Resistance curve**: khi kéo xuống, content không di chuyển 1:1 theo ngón tay. Thường có một *rubber-band effect* — kéo 100px nhưng content chỉ dịch 60px. Công thức hay dùng:

```
displayDelta = rawDelta * (1 - rawDelta / (rawDelta + maxPull))
```

Với `maxPull = 200px`, kéo 100px → hiển thị 67px. Kéo 300px → hiển thị 120px. Asymptote về `maxPull`. Đây là lý do không thể kéo content xuống vô tận.

**Passive event listeners**: `touchmove` mặc định có thể bị browser intercept để scroll — nếu app cần custom handling, phải declare `{ passive: false }` trong event listener. Tuy nhiên non-passive listeners có thể block scrolling, nên các framework như React Native có cơ chế riêng để handle điều này mà không bị jank.

**Trên iOS native** (`UIRefreshControl`): tất cả những gì trên đây được Apple xử lý sẵn. App chỉ cần attach `UIRefreshControl` vào `UIScrollView`, đăng ký callback, và gọi `endRefreshing()` khi xong. Spring animation và rubber band đều built-in.

**Trên web**: không có native API — phải tự implement toàn bộ touch logic. Thư viện như `react-pull-to-refresh` hay `better-scroll` gói lại phần này. Tuy nhiên trên mobile browser, còn phải deal với browser's built-in pull-to-refresh (Chrome Android), nên thường phải `overscroll-behavior-y: contain` để disable nó.

**Tại sao cần `will-change: transform`**: hint này báo cho browser biết element này sẽ được transform, cho phép browser tạo sẵn một compositor layer cho nó. Không có hint này, browser có thể promote element lên compositor layer *trong lúc animation đang chạy*, gây ra một frame bị drop ngay đầu.

## Mày thấy nó ở đâu trong thực tế

**Twitter/X**: pull-to-refresh của Twitter còn thêm một twist — nếu mày kéo rất chậm và dừng lại chưa qua threshold, nó release và không trigger refresh. Nhưng nếu mày kéo nhanh qua threshold rồi thả, dù content chưa đi đủ xa, nó vẫn trigger. Đây là *velocity detection* bổ sung vào *distance threshold* — cảm giác tự nhiên hơn vì phản ứng với *ý định* chứ không chỉ *khoảng cách*.

**Instagram Reels**: phần swipe-up giữa các video dùng kỹ thuật tương tự — track `touchmove`, dùng `transform: translateY` để kéo video tiếp theo vào frame. Khi thả, velocity quyết định video có snap sang trang tiếp theo hay snap về chỗ cũ. Không có `margin-top`, không có layout reflow, 60fps toàn bộ.

**Notion mobile**: thú vị ở chỗ Notion delay API call một chút sau khi spinner xuất hiện — nếu mày vừa refresh xong và kéo lại ngay lập tức, nó debounce và không gọi API ngay. Tránh spam request khi người dùng kéo liên tục.

## Một dòng để nhớ

Pull-to-refresh mượt vì animation và API call fire cùng lúc — không cái nào đợi cái nào.

---
*Bài tiếp theo: Tại sao đăng nhập Google một lần dùng được khắp nơi?*
