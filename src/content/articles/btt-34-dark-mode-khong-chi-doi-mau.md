---
title: "Tại sao dark mode không chỉ là đổi màu background?"
description: "CSS variables, prefers-color-scheme, OS integration, và tại sao dark mode đúng cách phức tạp hơn mày nghĩ."
category: programming
pubDate: 2026-08-03
series: "Behind the Tech: Bonus"
tags: ["dark-mode", "css", "ux", "frontend", "accessibility"]
---

Mày vào Settings trên iPhone, gạt sang Dark Mode, và toàn bộ hệ thống chuyển sang tối trong chưa đầy một giây. App của Apple trông hoàn hảo. Mấy app khác trông cũng ổn. Nhưng thỉnh thoảng mày mở một cái web app lên — nửa tối nửa sáng, icon trắng biến mất vào nền trắng, text đọc khó hơn ban ngày, mà cái spinner còn giữ nguyên màu xanh chói lọi. Sao cùng một thao tác mà kết quả lại khác nhau đến vậy?

Dark mode tưởng đơn giản — đổi màu nền từ trắng sang đen là xong. Nhưng thực ra có nhiều layer kỹ thuật chồng lên nhau, và mỗi layer giải quyết một vấn đề mà layer trước không xử lý được. Vậy thật sự cần bao nhiêu thứ để dark mode hoạt động đúng?

## Cách naive — tại sao nó không work

Cách đầu tiên ai cũng nghĩ tới: thêm class `dark` vào `<body>`, rồi viết CSS override:

```css
body.dark { background: #000; color: #fff; }
body.dark .card { background: #111; }
body.dark .button { background: #333; color: #fff; }
body.dark .header { background: #1a1a1a; border-color: #444; }
/* ... */
```

Với 10 component thì làm được. Với 100 component thì bắt đầu vỡ. Mày có 500 chỗ hardcode màu trong codebase — mỗi lần thêm component mới phải nhớ viết thêm dark variant. Designer đổi màu primary từ `#0066cc` sang `#0055bb` — mày phải tìm và sửa ở 30 chỗ khác nhau. Một developer khác thêm component mới quên viết dark variant — nó sẽ hiện màu trắng chói trên nền đen.

Đây không phải vấn đề của dark mode — đây là vấn đề của hardcoded values. Dark mode chỉ làm lộ nó ra sớm hơn.

## Cái trick thật sự đằng sau

**Layer 1: CSS Custom Properties** — đây là nền tảng.

Thay vì hardcode màu ở mỗi component, mày định nghĩa một bộ biến màu một lần duy nhất:

```css
:root {
  --bg: #ffffff;
  --bg-secondary: #f5f5f5;
  --text: #111111;
  --text-muted: #666666;
  --border: #e0e0e0;
}

[data-theme="dark"] {
  --bg: #0d0d14;
  --bg-secondary: #16161f;
  --text: #e8eaf0;
  --text-muted: #9498a8;
  --border: #2a2a38;
}
```

Tất cả component chỉ dùng `var(--bg)`, `var(--text)` — không hardcode một màu nào. Khi attribute `data-theme="dark"` được gán lên `<html>`, toàn bộ CSS variables bị override, và **tất cả component thay đổi cùng lúc**. Không cần cascade qua từng class, không cần nhớ viết override riêng cho mỗi component.

```css
.card {
  background: var(--bg-secondary);
  color: var(--text);
  border: 1px solid var(--border);
}
/* Tự động đúng cả light lẫn dark — không cần viết thêm gì */
```

**Layer 2: prefers-color-scheme** — để app tự follow hệ điều hành.

OS expose system theme qua một media query CSS:

```css
@media (prefers-color-scheme: dark) {
  :root {
    --bg: #0d0d14;
    --text: #e8eaf0;
  }
}
```

Không cần JavaScript. Khi user gạt dark mode trong System Settings, browser nhận tín hiệu từ OS, media query match, CSS variables được áp dụng ngay lập tức. Zero JS, zero event listener.

JavaScript cũng đọc được nếu cần:

```js
const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches
```

Và lắng nghe khi user đổi preference trong lúc app đang mở:

```js
window.matchMedia('(prefers-color-scheme: dark)')
  .addEventListener('change', e => applyTheme(e.matches ? 'dark' : 'light'))
```

## Đi sâu hơn — chi tiết kỹ thuật

**User override + Flash of Wrong Theme**

Vấn đề xuất hiện khi user muốn chọn theme khác với OS. OS là dark, nhưng họ muốn app ở light. Cần lưu preference:

```js
localStorage.setItem('theme', 'light')
```

Đọc lại khi load trang. Nhưng nếu mày làm thế này:

```js
// Trong React component, sau khi render
useEffect(() => {
  const saved = localStorage.getItem('theme')
  if (saved) document.documentElement.setAttribute('data-theme', saved)
}, [])
```

User sẽ thấy **Flash of Wrong Theme (FOWT)**: trang render ra trước với màu mặc định, rồi một cái giật nhỏ khi theme được apply sau. Với dark mode, cái flash đó là màn hình trắng bật sáng trong tích tắc — rất dễ nhận ra, trông rất nghiệp dư.

Fix duy nhất: apply theme **trước khi browser render bất cứ thứ gì**. Đặt một inline script trong `<head>`, trước cả file CSS:

```html
<head>
  <script>
    const saved = localStorage.getItem('theme')
    const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches
    const theme = saved || (prefersDark ? 'dark' : 'light')
    document.documentElement.setAttribute('data-theme', theme)
  </script>
  <link rel="stylesheet" href="/styles.css">
</head>
```

Script này chạy synchronous, block rendering cho đến khi xong — nghe có vẻ tệ nhưng nó chỉ chạy mấy dòng JS đơn giản, thực tế dưới 1ms. Kết quả: browser không bao giờ render trang với theme sai, không có flash.

**Những thứ mà CSS variables không giải quyết được**

Photos không cần thay đổi theo dark mode — đúng. Nhưng nhiều thứ khác thì cần:

*Icons*: Icon SVG dạng fill đen trên nền trắng → dark mode cần variant trắng. Có thể dùng CSS `filter: invert(1)` nhưng không chính xác với icon nhiều màu. Cách đúng là dùng `currentColor` trong SVG để icon tự inherit màu text.

*Syntax highlighting*: Code block với màu light theme trông hoàn toàn khác trên dark background. Không phải đổi vài màu — là cả bộ palette hoàn toàn khác (Dracula, One Dark vs. GitHub Light, Solarized Light).

*Shadow và elevation*: Trên light background, shadow tối tạo cảm giác độ sâu. Trên dark background, shadow tối gần như vô hình. Dark mode đúng cách dùng subtle glow thay vì shadow:

```css
/* Light mode */
.card { box-shadow: 0 2px 8px rgba(0, 0, 0, 0.15); }

/* Dark mode */
[data-theme="dark"] .card {
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.5);
  /* Hoặc dùng glow thay thế: */
  /* box-shadow: 0 0 0 1px rgba(255, 255, 255, 0.08); */
}
```

*Native controls*: Scrollbar, checkbox, radio button, select dropdown — những thứ này do browser render theo OS style. CSS property `color-scheme` ra lệnh cho browser dùng dark variant của các control đó:

```css
:root { color-scheme: light; }
[data-theme="dark"] { color-scheme: dark; }
```

Không có dòng này, scrollbar vẫn trắng dù toàn bộ trang đã tối.

**Tại sao dark mode không phải chỉ là đảo màu**

Pure white `#ffffff` và pure black `#000000` tạo ra contrast ratio 21:1 — cao nhất có thể theo WCAG. Nghe có vẻ tốt. Thực tế thì chói và gây mỏi mắt khi đọc lâu trong môi trường tối.

Good dark mode palette dùng **off-black** và **off-white**:

```
Background: #0d0d14  (không phải #000000)
Text:       #e8eaf0  (không phải #ffffff)
```

`#0d0d14` vs `#000000` — chênh nhau rất ít về giá trị hex nhưng mắt cảm nhận được sự khác biệt sau 30 phút đọc. Đây là lý do designer tốn nhiều thời gian calibrate dark palette — không phải đảo màu, mà là thiết kế lại từ đầu với một bộ màu hoàn toàn khác.

## Mày thấy nó ở đâu trong thực tế

Mở DevTools trên bất kỳ trang web nào có dark mode, tab Elements. Toggle `data-theme` attribute trên `<html>` và quan sát CSS variables thay đổi trong tab Computed Styles — mày sẽ thấy ngay layer 1 hoạt động thế nào.

Để giả lập OS dark mode mà không cần đổi system settings: DevTools → Rendering tab (More tools) → Emulate CSS media feature `prefers-color-scheme` → `dark`. Trang web react ngay nếu nó dùng `@media (prefers-color-scheme: dark)`.

**Tailwind CSS** có `darkMode: 'class'` config — bật class `dark` trên `<html>` thì tất cả `dark:bg-gray-900` variant được apply. Bên dưới nó vẫn là CSS, không có gì magic. **shadcn/ui** và hầu hết component library hiện đại build trên CSS variables nên dark mode tự động hoạt động khi mày swap theme.

Nếu mày build app từ đầu: đặt tất cả màu vào CSS variables từ ngày đầu tiên, ngay cả khi chưa có dark mode. Khi cần thêm dark mode sau, mày chỉ cần thêm một block `[data-theme="dark"]` với bộ giá trị mới — toàn bộ app follow ngay, không cần sửa component nào.

## Một dòng để nhớ

Dark mode đúng cách là thiết kế lại bộ màu, không phải đảo màu — CSS variables chỉ là công cụ để deploy nó hiệu quả.

---
*Bài tiếp theo: (hết series Behind the Tech)*
