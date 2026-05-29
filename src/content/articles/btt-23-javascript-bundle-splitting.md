---
title: "Tại sao bundle JavaScript được split nhỏ thay vì một file khổng lồ?"
description: "Tải landing page mà phải kéo theo code của admin dashboard — đó là vấn đề bundle khổng lồ. Code splitting, dynamic import, và content hash giải quyết nó như thế nào."
category: programming
pubDate: 2026-07-22
series: "Behind the Tech: Frontend"
tags: ["javascript", "bundling", "webpack", "vite", "performance", "code-splitting"]
---

Mày mở một trang web bán hàng. Landing page đơn giản — logo, mấy cái ảnh sản phẩm, nút mua. Nhưng Chrome DevTools báo tải về 2MB JavaScript. Cái landing page đó cần gì mà nặng vậy?

Câu trả lời thường là: nó đang tải cả code của trang admin, trang checkout, trang dashboard, và có khi cả một đống thư viện mày không dùng trên trang đó. Tất cả gom vào một file. Mày vào xem landing page nhưng browser phải download, parse, và compile toàn bộ codebase. Vậy thì tại sao không tách nhỏ ra?

## Cách naive — tại sao nó không work

Cách build đơn giản nhất: gom tất cả JavaScript vào một `bundle.js`. Webpack hay Vite đọc hết các file `.js`, `.ts`, `.jsx`, resolve hết import, đóng gói thành một file duy nhất. Một HTTP request, một file, xong.

Trên lý thuyết thì sạch. Thực tế thì:

**User tải thứ họ không cần.** Landing page cần 50KB logic. Admin dashboard cần 800KB. Checkout cần 300KB. Bundle khổng lồ có tất cả — và user tải trang chủ phải kéo theo 1150KB code không bao giờ chạy ở trang đó.

**Parse time chết người.** JavaScript không chỉ download — browser còn phải parse và compile nó trước khi chạy. Trên điện thoại tầm trung, 2MB JS có thể mất 3–5 giây chỉ để parse. Trong lúc đó, trang không tương tác được dù HTML đã hiện ra rồi.

**Cache invalidation quá tệ.** Mày sửa một dòng CSS-in-JS ở trang admin. Bundle hash thay đổi. User phải tải lại toàn bộ 2MB. Dù họ không bao giờ vào trang admin.

## Cái trick thật sự đằng sau

Giải pháp là **Code Splitting** — thay vì một bundle, build tool tạo ra nhiều chunk nhỏ, chỉ tải chunk nào cần thiết cho trang đang xem.

Có ba kỹ thuật chính:

**1. Dynamic import()**

Thay vì:
```js
import HeavyChart from './HeavyChart'
```

Mày viết:
```js
const HeavyChart = await import('./HeavyChart')
```

Vite và Webpack nhìn thấy `import()` (dynamic import) — chúng tự động tách `HeavyChart` ra thành một chunk riêng. Chunk đó chỉ được request khi dòng code đó thực sự chạy. User không đi đến tính năng có chart → file không bao giờ tải về.

**2. Route-based splitting**

Trong React, pattern phổ biến nhất:

```js
const AdminPage = React.lazy(() => import('./pages/Admin'))
const CheckoutPage = React.lazy(() => import('./pages/Checkout'))

// React Router
<Route path="/admin" element={
  <Suspense fallback={<Spinner />}>
    <AdminPage />
  </Suspense>
} />
```

`React.lazy` bên dưới dùng dynamic import. Khi user navigate đến `/admin`, React mới request chunk của `AdminPage`. Trước đó không tải gì cả. Mỗi route là một chunk riêng, lazy-loaded khi cần.

**3. Vendor splitting**

`node_modules` thường chiếm 60–70% tổng bundle size. React, React DOM, lodash, date-fns... Những thứ này không thay đổi mỗi khi mày deploy. Vậy thì tách chúng ra:

```
app.a1b2c3.js     — code của mày (thay đổi thường)
vendor.x9y8z7.js  — react, react-dom, ... (hiếm khi thay đổi)
```

User lần đầu tải cả hai. Lần sau mày deploy code mới: `app.d4e5f6.js` là file mới, nhưng `vendor.x9y8z7.js` vẫn cùng hash → browser dùng cache. Không cần tải lại 500KB thư viện.

Sơ đồ đầy đủ trông như thế này:

```
build/
├── index.html
├── app.a1b2c3.js          ← entry point (nhỏ, ~50KB)
├── vendor.x9y8z7.js       ← react + deps (~150KB, cache lâu dài)
├── chunk-admin.b2c3d4.js  ← chỉ load khi vào /admin
├── chunk-checkout.e5f6a7.js
└── chunk-dashboard.g8h9i0.js

User vào landing page:
  ✓ app.a1b2c3.js     (50KB)
  ✓ vendor.x9y8z7.js  (150KB, cached)
  ✗ chunk-admin.js    (không tải)
  ✗ chunk-checkout.js (không tải)
```

## Đi sâu hơn — chi tiết kỹ thuật

**Tree shaking** là kỹ thuật đi kèm với code splitting — loại bỏ code chết trước khi bundle.

```js
// math.js
export function add(a, b) { return a + b }
export function multiply(a, b) { return a * b }
export function fibonacci(n) { /* 200 dòng code */ }

// app.js
import { add } from './math'
```

Bundler nhìn vào import graph: `add` được dùng, `multiply` và `fibonacci` không. Chúng bị loại khỏi bundle hoàn toàn. Điều kiện: phải dùng **ES modules** (`import`/`export`), không phải CommonJS (`require`). CommonJS là dynamic — `require(someVariable)` — bundler không thể biết tĩnh cái gì được dùng. ES modules là static, phân tích được tại build time.

**Content hash trong tên file** là lý do mày thấy tên file kỳ lạ như `app.a1b2c3.js`:

```
app.a1b2c3.js  → nội dung file → hash ra "a1b2c3"
```

Hash thay đổi khi và chỉ khi nội dung file thay đổi. Điều này cho phép set `Cache-Control: max-age=31536000, immutable` — cache 1 năm. Browser không bao giờ re-request file có hash không đổi. Chỉ khi code thay đổi thì hash mới đổi, URL mới → browser tải file mới.

**Network waterfall** với code splitting được thiết kế theo thứ tự ưu tiên:

```
0ms   → HTML tải về (inline critical CSS)
50ms  → app.js tải về (entry point nhỏ)
100ms → vendor.js tải về (parallel)
200ms → trang interactive (First Input Delay thấp)
         ... user scroll, click
500ms → chunk trang hiện tại tải xong
```

Thay vì block 2 giây để tải hết 2MB rồi mới interactive, user có thể tương tác với trang sau 200ms và các chunk còn lại load ngầm.

**Preloading** là optimization tiếp theo: thay vì đợi user click mới bắt đầu tải chunk, mày có thể hint browser load trước:

```html
<link rel="modulepreload" href="/chunk-checkout.e5f6a7.js">
```

Hoặc trong code, khi user hover vào nút "Checkout", bắt đầu prefetch chunk đó. Khi họ thực sự click, chunk đã sẵn sàng.

## Mày thấy nó ở đâu trong thực tế

Mở Chrome DevTools, vào tab Network, lọc theo JS, reload bất kỳ trang web nào làm bằng React hay Vue. Mày sẽ thấy nhiều file `chunk-xxxx.hash.js` được tải — đó là code splitting đang chạy. Navigate qua các trang khác nhau và xem chunk nào được request thêm.

**Vite** làm code splitting mặc định — dynamic import tự động tạo chunk, vendor split được config sẵn trong `build.rollupOptions`. **Webpack** cần config `splitChunks` trong `optimization`, nhưng `create-react-app` và các scaffold thường đã làm sẵn.

**Next.js** và **Remix** đi xa hơn: route-based splitting là kiến trúc cốt lõi, không phải optional. Mỗi page là server component riêng, chỉ JS cần thiết cho route đó được gửi xuống client.

Trên Chrome DevTools, Coverage tab (Cmd+Shift+P → "Coverage") cho mày thấy % code đang bị load nhưng không chạy. Nếu con số đó > 50%, đó là dấu hiệu bundle chưa được split đủ tốt.

## Một dòng để nhớ

Code splitting không phải tối ưu — đó là cách đúng đắn để gửi cho browser chính xác thứ nó cần, không hơn không kém.

---
*Bài tiếp theo: Lighthouse đang chấm điểm web của mày dựa trên cái gì thật ra?*
