---
title: "Tại sao URL shortener như bit.ly redirect gần như instant?"
description: "Click vào bit.ly/3xK9mP và mày đến đích trong tích tắc. Đằng sau đó là một database lookup, một HTTP response code, và một cái trick browser caching mà phần lớn dev không biết."
category: system-design
pubDate: 2026-07-31
series: "Behind the Tech: Search"
tags: ["url-shortener", "redis", "http-redirect", "cdn", "system-design"]
---

Mày nhận được link `bit.ly/3xK9mP` từ ai đó trên Twitter. Click vào. Trong nháy mắt, mày đang ở trang đích — một bài Medium dài 20 phút đọc. Không có loading screen nào của bit.ly, không có trang trung gian nào. Cứ như là link thẳng vậy.

Nhưng cái URL đó phải đi qua server của bit.ly để biết nó trỏ về đâu. Lookup một record trong database. Rồi redirect mày. Sao cái đó lại nhanh hơn cả việc gõ thẳng URL gốc?

## Cách naive — tại sao nó không work

Kiến trúc đơn giản nhất cho URL shortener: một bảng SQL với hai cột — `short_code` và `long_url`. Mỗi khi có request đến `bit.ly/3xK9mP`:

1. Query database: `SELECT long_url FROM urls WHERE short_code = '3xK9mP'`
2. Trả về HTTP redirect đến `long_url`

Về mặt kỹ thuật thì đúng. Nhưng bit.ly xử lý hàng tỷ click mỗi tháng. Ở quy mô đó, mỗi click = một SQL query đến cùng một database = bottleneck kinh khủng. Database bắt đầu quá tải, latency tăng, và cái "instant redirect" của mày trở thành vài giây chờ đợi.

Còn một vấn đề nữa: nếu database server ở Mỹ và mày đang click từ Việt Nam, network round-trip đã mất ~200ms trước khi query thậm chí bắt đầu.

## Cái trick thật sự đằng sau

Giải pháp gồm ba lớp chồng lên nhau.

**Lớp 1: Redis thay vì SQL**

Toàn bộ mapping `short_code → long_url` được lưu trong **Redis** — một key-value store in-memory. Không phải database quan hệ, không có schema, không có SQL parser, không có disk I/O. Chỉ là lookup trong RAM.

```
Redis:
  "3xK9mP" → "https://medium.com/very-long-article-url/..."
  "9aB2nX" → "https://github.com/some-repo/some-file"
  "7cD5pQ" → "https://docs.python.org/..."
```

Redis lookup là **O(1)**, dưới 1ms ngay cả với hàng trăm triệu keys. So với SQL query đến spinning disk có thể mất 5-50ms.

**Lớp 2: HTTP 301 và browser cache**

Đây là phần mà hầu hết dev không nghĩ đến. Khi bit.ly trả về redirect, nó dùng một trong hai HTTP status code:

- **301 Moved Permanently**: redirect này là vĩnh viễn. Browser **cache lại** mapping này. Lần sau mày click cùng link, browser redirect ngay lập tức mà **không gửi request đến bit.ly**. Zero latency.
- **302 Found (Temporary)**: redirect này có thể thay đổi. Browser không cache. Mỗi click đều phải hỏi server.

```
Lần 1 (301):
  Browser → bit.ly/3xK9mP → Server → "301 → medium.com/..."
  [browser lưu: 3xK9mP = medium.com/...]

Lần 2:
  Browser → bit.ly/3xK9mP → [browser tự redirect, không gửi request]
                              → medium.com/...
```

Nhưng bit.ly không dùng 301 cho link thông thường — họ dùng **302**. Lý do: nếu dùng 301, click sẽ không đi qua server của họ, và họ không thể đếm analytics (số click, device, location). 302 đảm bảo mỗi click đều được track. Đây là trade-off giữa tốc độ và business model.

**Lớp 3: Edge CDN**

Server của bit.ly không nằm ở một chỗ. Họ deploy infrastructure tại hàng trăm **PoP (Point of Presence)** trên toàn thế giới — mỗi location đều có Redis instance với full dataset. Request của mày được route đến node gần nhất.

```
Mày (Hà Nội)
      |
      ▼
[DNS lookup: bit.ly → IP gần nhất]
      |
      ▼
Edge node Singapore (~20ms)
  Redis lookup < 1ms
      |
      ▼
HTTP 302 → destination URL
```

Thay vì 200ms đến datacenter ở Mỹ, mày có < 30ms đến Singapore.

## Đi sâu hơn — chi tiết kỹ thuật

**Tạo short code như thế nào?**

Có hai cách phổ biến:

**Counter-based (base62 encoding):** Dùng một auto-increment counter. ID = 1, 2, 3, 4... Encode sang base62 (0-9, a-z, A-Z). ID 1 = "1", ID 62 = "Z", ID 63 = "10", ID 3521614606208 = "3xK9mP". 7 ký tự base62 có thể encode 3.5 nghìn tỷ URLs. Không bao giờ có collision, nhưng sequential — ai đó có thể đoán ID tiếp theo.

**Random hash:** Generate random 6-7 ký tự, check xem đã tồn tại chưa, nếu collision thì generate lại. Với 6 ký tự base62 có 56 tỷ combinations — xác suất collision thấp nhưng không bằng zero.

**Hash collision trong thực tế:**

```python
def create_short_url(long_url):
    for _ in range(5):  # max 5 attempts
        code = generate_random(6)
        if not redis.exists(code):
            redis.set(code, long_url)
            return code
    # fallback: dùng counter
    return encode_base62(counter.increment())
```

**Vanity URLs:** `bit.ly/mycompany` — user tự chọn slug. Vẫn là Redis key, nhưng được đặt thủ công. Ưu tiên check vanity URL trước random code để tránh conflict.

**Expiration:** Redis hỗ trợ TTL (Time To Live) native. `SETEX code 86400 url` — key tự xóa sau 86400 giây (1 ngày). URL shortener cho marketing campaign hay dùng tính năng này.

**Read replica:** Đọc nhiều hơn ghi rất nhiều (mỗi URL được tạo 1 lần nhưng click hàng nghìn lần). Redis có thể setup **read replicas** — nhiều instance chỉ để đọc, một instance master để ghi. Scale read throughput horizontally.

**Analytics pipeline:**

Với 302, mỗi click qua server. Nhưng không thể làm analytics synchronously trong request path — sẽ làm chậm redirect. Thay vào đó:

```
Click → Redis lookup → HTTP 302 response (gửi ngay)
     ↓
  [async] push event vào message queue (Kafka)
     ↓
  [background] consumer xử lý analytics, ghi vào data warehouse
```

User nhận redirect ngay lập tức. Analytics được xử lý bất đồng bộ, không ảnh hưởng latency.

## Mày thấy nó ở đâu trong thực tế

**QR code:** Về bản chất QR code link đến một URL shortener. Thay đổi destination mà không cần in lại QR — chỉ cần update mapping trong Redis. Đây là lý do các công ty dùng QR code của bên thứ ba thay vì encode thẳng URL gốc.

**Link tracking trong email marketing:** Mọi link trong email từ Mailchimp, HubSpot đều là redirect qua server của họ. Không phải bit.ly, nhưng cùng cơ chế — dùng 302 để track ai click link nào. Đây là lý do URL trong email marketing trông kỳ lạ và dài.

**Instagram/Twitter profile link:** Instagram không cho link trong caption, chỉ cho "link in bio". Nhiều người dùng Linktree hoặc similar — bản chất là một URL shortener với landing page tùy chỉnh.

**A/B testing links:** Cùng một short URL, 50% user redirect đến version A, 50% đến version B. Logic được xử lý ở lớp redirect, transparent với user.

## Một dòng để nhớ

URL shortener nhanh không phải vì redirect đơn giản — mà vì Redis in-memory lookup, edge nodes gần người dùng, và browser cache xử lý phần còn lại.

---
*Bài tiếp theo: Tại sao "đang online" trên Messenger không phải lúc nào cũng chính xác?*
