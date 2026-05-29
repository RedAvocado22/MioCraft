---
title: "Tại sao Google Search gợi ý ngay khi mày gõ mà không lag?"
description: "Mỗi lần mày gõ một chữ, Google trả về gợi ý trong dưới 50ms. Không phải vì server Google nhanh — mà vì có rất nhiều thứ xảy ra trước khi request đó thậm chí được gửi đi."
category: system-design
pubDate: 2026-07-03
series: "Behind the Tech: App & UX"
tags: ["autocomplete", "trie", "debounce", "search", "performance", "ux"]
---

Mày gõ "vi" vào Google Search. Chưa kịp nghĩ tiếp, dropdown đã xuất hiện với "vietnam", "video", "viet nam", "viết đơn xin việc". Mày gõ thêm "vie" — danh sách thay đổi ngay lập tức, không có bất kỳ khoảng delay nào nhận thấy được. Toàn bộ quá trình từ lúc mày nhấn phím đến lúc gợi ý hiện ra: dưới 100ms.

Mà Google có hàng tỷ query trong database. Mỗi giây có hàng triệu người đang gõ đồng thời. Làm thế nào một hệ thống ở quy mô đó có thể response nhanh hơn cả tốc độ mày nhận ra độ trễ?

## Cách naive — tại sao nó không work

Đây là điều đầu tiên bất kỳ developer nào nghĩ đến: mỗi khi user gõ một ký tự, gửi HTTP request đến server với prefix hiện tại, server tìm kiếm và trả về danh sách gợi ý.

Vấn đề bắt đầu từ **keystroke rate**. Người gõ bình thường đạt 60-80 WPM, tức khoảng 5-6 ký tự/giây. Điều đó có nghĩa 5-6 HTTP request/giây từ mỗi người dùng. Với hàng triệu người dùng đồng thời, server phải xử lý hàng triệu request/giây chỉ cho autocomplete — chưa kể search thật sự.

Vấn đề thứ hai: **race condition**. Request cho "vie" gửi đi sau "vi", nhưng "vi" có thể trả về response sau "vie" nếu network không ổn định. Dropdown sẽ hiện sai gợi ý — gợi ý của prefix ngắn hơn hiển thị sau gợi ý của prefix dài hơn.

Vấn đề thứ ba: **perceived lag**. Ngay cả khi server trả về trong 50ms, với mỗi keystroke đều trigger một network round-trip, user sẽ thấy dropdown "nhảy" liên tục theo từng chữ gõ — distraction thay vì helpful.

## Cái trick thật sự đằng sau

Giải pháp không phải là làm server nhanh hơn. Giải pháp là **giảm số lần request được gửi đi**, và **lookup phía server cực kỳ nhanh** khi request thật sự đến.

**Client side: Debounce**

Thay vì gửi request mỗi keystroke, debounce delay việc gửi request cho đến khi user ngừng gõ một khoảng thời gian ngắn (thường 150-300ms):

```
Mày gõ: v → i → e → t
         |   |   |   |
debounce: CANCEL → CANCEL → CANCEL → gửi request "viet" (sau 200ms không gõ thêm)
```

Kết quả: thay vì 4 request, chỉ có 1 request. Giảm 75% request ngay lập tức, mà user không nhận ra sự khác biệt vì 200ms vẫn nhanh hơn tốc độ mắt phân biệt.

**Server side: Trie data structure**

Server không dùng SQL `LIKE 'viet%'` để search — cách đó phải scan toàn bộ index. Thay vào đó, toàn bộ vocabulary của autocomplete được lưu trong một **Trie** (cây prefix).

```
         [root]
        /   |   \
       v    g    k ...
       |    |
       i    o
       |    |
       e    o
      / \   |
     t   n  g
     |   |  |
     ...  a  l
          |  |
          m  e ...
          |
         "vietnam"
```

Mỗi node là một ký tự. Mỗi path từ root đến một node là một prefix. Để tìm tất cả từ bắt đầu bằng "viet": đi theo path v→i→e→t, rồi traverse toàn bộ subtree từ đó. Độ phức tạp là **O(m + k)** trong đó m = độ dài prefix, k = số kết quả trả về. Không liên quan gì đến tổng số từ trong dictionary — dù có 1 tỷ từ, lookup vẫn nhanh như nhau.

## Đi sâu hơn — chi tiết kỹ thuật

**Trie node structure:**

```python
class TrieNode:
    def __init__(self):
        self.children = {}      # char -> TrieNode
        self.suggestions = []   # top-N suggestions tại node này
        self.is_end = False
```

Điểm quan trọng: mỗi node lưu sẵn danh sách `suggestions` — top 10 gợi ý phổ biến nhất cho prefix đó. Khi insert một từ vào Trie, cập nhật suggestions của tất cả ancestor nodes. Khi query, chỉ cần đi đến đúng node và return `node.suggestions` — không cần traverse subtree thêm nữa.

**Ranking:** Gợi ý không phải random — mỗi suggestion có score dựa trên:
- **Global search frequency:** "vietnam" được search nhiều hơn "viet nam" (có dấu cách)
- **Location signal:** Ở Việt Nam gõ "vi" → "vieclam24h" rank cao. Ở Mỹ → "vitamins" rank cao hơn
- **Personalization:** Query history của mày. Nếu mày hay search "video tutorial", "video" sẽ rank cao hơn cho mày

**Client-side cache:**

```javascript
const cache = new Map();

async function getSuggestions(prefix) {
  if (cache.has(prefix)) return cache.get(prefix);

  const results = await fetchSuggestions(prefix);
  cache.set(prefix, results);
  return results;
}
```

Browser cache kết quả theo prefix. "vie" → cache. Nếu mày xóa một chữ về lại "vi", kết quả trả ngay từ cache, zero network request. Tỷ lệ cache hit rất cao vì người ta thường gõ rồi xóa rồi gõ lại.

**Edge CDN:** Request autocomplete không đến datacenter của Google ở US — nó đến server gần mày nhất (ở Việt Nam là Singapore hoặc HK). Latency giảm từ ~200ms xuống ~20-30ms. Đây là lý do response dưới 50ms dù Trie ở đây chứa vài chục GB data.

**Prefetch:** Google còn làm thêm một bước: khi mày gõ "vi", không chỉ fetch gợi ý cho "vi" mà còn prefetch gợi ý cho top 3-5 ký tự tiếp theo có khả năng xảy ra nhất ("vie", "vid", "vin"...). Khi mày thật sự gõ tiếp, kết quả đã có trong cache rồi.

**Cancellation:** Race condition được fix bằng cách cancel request cũ khi request mới được gửi:

```javascript
let controller = null;

async function fetchWithCancel(prefix) {
  if (controller) controller.abort();  // cancel request trước
  controller = new AbortController();

  const res = await fetch(`/autocomplete?q=${prefix}`, {
    signal: controller.signal
  });
  return res.json();
}
```

## Mày thấy nó ở đâu trong thực tế

**Shopee / Lazada search:** Cùng cơ chế nhưng có điểm khác biệt thú vị. Gợi ý của Shopee không chỉ dựa trên prefix match — mà còn dùng **fuzzy matching** để handle typo. Gõ "airpods" hay "airpot" đều ra kết quả "airpods". Họ kết hợp Trie với **edit distance algorithm** để tìm các từ gần đúng.

**VS Code IntelliSense:** Autocomplete trong IDE dùng Trie cho keyword và built-in functions, nhưng thêm một layer nữa là **Language Server Protocol (LSP)**. LSP analyze cả codebase của mày để suggest tên biến, method của object cụ thể. Vẫn dùng debounce, nhưng threshold thấp hơn (~100ms) vì developer cần feedback nhanh hơn.

**Elasticsearch / Algolia:** Cả hai đều có built-in autocomplete feature. Algolia nổi tiếng về tốc độ — họ ship Trie index lên RAM của tất cả edge nodes, đảm bảo sub-10ms response. Đây là lý do các e-commerce site dùng Algolia có search cực kỳ nhanh dù chạy trên server của bên thứ ba.

## Một dòng để nhớ

Autocomplete nhanh không phải vì server mạnh — mà vì phần lớn work được làm ở client (debounce, cache) và phần còn lại được cấu trúc để skip hầu hết data (Trie).

---
*Bài tiếp theo: Tại sao YouTube không buffer từ đầu mà buffer đúng đoạn mày đang xem?*
