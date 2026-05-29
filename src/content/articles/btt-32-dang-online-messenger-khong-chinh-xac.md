---
title: "Tại sao 'đang online' trên Messenger không phải lúc nào cũng chính xác?"
description: "Bạn thân mày hiện 'Active now' nhưng không reply 20 phút. Hay mày tắt app rồi mà vẫn thấy online. Đây không phải bug — đây là hàng loạt trade-off có chủ ý."
category: system-design
pubDate: 2026-08-01
series: "Behind the Tech: Bonus"
tags: ["online-presence", "real-time", "websocket", "heartbeat", "privacy", "messaging"]
---

Mày nhắn tin cho ai đó trên Messenger. Họ hiện "Active now" — xanh lè, rõ ràng đang online. Mày chờ. 5 phút. 10 phút. 20 phút. Không reply. Mày bắt đầu nghĩ đủ thứ.

Hoặc ngược lại: mày vừa đặt điện thoại xuống, chưa kịp lock màn hình, app Messenger vẫn mở — nhưng người khác đã không còn thấy mày "Active now" nữa. Cái indicator đó không phải đơn giản là "đang có kết nối". Nó phức tạp hơn nhiều, và phần lớn sự không chính xác là **có chủ ý**.

## Cách naive — tại sao nó không work

Định nghĩa đơn giản nhất của "online": user có WebSocket connection đang mở đến server. Khi app mở = connection alive = online. Khi app tắt = connection đóng = offline.

Đơn giản, chính xác, realtime. Vậy tại sao không làm vậy?

Vấn đề là **quy mô**. Messenger có hơn 1 tỷ người dùng. Mỗi người có trung bình vài trăm bạn bè. Để hiển thị online status chính xác real-time, mỗi khi user A online/offline, phải notify tất cả bạn bè của A. Tất cả bạn bè của họ phải query trạng thái của A.

Nhân số lên: 1 tỷ user × vài trăm bạn = hàng trăm tỷ status checks mỗi lần có ai đó connect hay disconnect. Với mạng di động hay WiFi không ổn định — người dùng connect/disconnect hàng chục lần mỗi giờ — con số này bùng nổ hoàn toàn.

Cái naive approach không fail vì sai về mặt logic. Nó fail vì không thể scale.

## Cái trick thật sự đằng sau

Thay vì real-time chính xác hoàn toàn, Messenger dùng **heartbeat + TTL**. Đây là cơ chế nền tảng.

**Heartbeat mechanism:**

App gửi "ping" đến server mỗi 30-60 giây — một packet nhỏ để nói "tao vẫn đây". Server nhận heartbeat, cập nhật timestamp trong Redis:

```
Redis:
  user_1234_last_seen = 1717200000  (Unix timestamp)
```

Khi ai đó check online status của user_1234:

```
now - last_seen < 60s  →  "Active now"
now - last_seen < 5 phút  →  "Active 3 minutes ago"
otherwise  →  "last seen [timestamp]"
```

Nếu heartbeat dừng lại — app bị kill, mạng mất, điện thoại hết pin — Redis TTL tự expire sau ~60-90 giây. User tự động trở thành "offline" mà không cần server detect connection drop.

```
App                     Server                   Redis
 |                         |                       |
 |  heartbeat ping ──────> |                       |
 |                         |  SET last_seen=now ─> |
 |  (30s later)            |                       |
 |  heartbeat ping ──────> |                       |
 |                         |  SET last_seen=now ─> |
 |  (app killed)           |                       |
 |                         |                       | TTL expires
 |                         |                       | key deleted
 |                         |                       |
 |                         |  check: key missing → "offline"
```

## Đi sâu hơn — chi tiết kỹ thuật

**Vấn đề 1: Multiple devices**

Mày có thể đang dùng Messenger trên điện thoại, máy tính, và tablet cùng lúc. Cả ba đều gửi heartbeat. Mày "online" trên tất cả thiết bị.

Solution: mỗi thiết bị có session riêng trong Redis, nhưng user status được tính bằng OR — nếu **bất kỳ** thiết bị nào gửi heartbeat gần đây, user là online. "Last seen" là timestamp gần nhất từ tất cả devices.

```
user_1234:
  device_phone:   last_seen = now - 30s  → active
  device_desktop: last_seen = now - 4m   → idle
  device_tablet:  last_seen = now - 2h   → offline

user status: "Active now" (vì phone còn active)
```

**Vấn đề 2: "Active" ≠ "có connection"**

App có thể đang chạy background trên iOS/Android với WebSocket vẫn mở — nhưng user không nhìn vào màn hình. Connection alive không đồng nghĩa user đang chú ý.

Meta phân biệt hai khái niệm:
- **Connected:** WebSocket còn sống
- **Active:** user đã tương tác với app (tap, scroll, type) trong X phút gần đây

"Active now" chỉ hiện khi user **thực sự interact**, không chỉ là app đang mở. App được foreground không đủ — phải có user gesture. Threshold thường là 2-5 phút không có interaction = chuyển sang "Recently active".

Đây là lý do bạn mày có thể "Active now" nhưng thực ra đang đọc news trong tab khác, điện thoại nằm trên bàn mà không ai cầm.

**Vấn đề 3: Privacy — delay có chủ ý**

Meta không hiển thị "last seen" chính xác đến giây. Timestamp được **làm tròn và delay**:

- "Active now" → thực ra có thể là active 1-5 phút trước
- "Active 5 minutes ago" → thực ra có thể là 3-8 phút trước
- "Active 1 hour ago" → bucket rộng hơn, không chính xác

Lý do: giảm **social pressure**. Nếu mày thấy bạn mày "Active 2 minutes ago" mà không reply tin nhắn mày gửi 3 phút trước — rõ ràng là bị ignore. Delay và làm tròn tạo ra ambiguity, giảm anxiety và conflict. Facebook đã có những nghiên cứu user behavior cho thấy timestamps chính xác gây ra nhiều drama xã hội.

Mày cũng có thể **tắt hoàn toàn** last seen — trong settings, "Show when you're active". Khi tắt, người khác không thấy gì. Trade-off: mày cũng không thấy last seen của họ.

**Vấn đề 4: Selective visibility**

Không phải mọi contact đều thấy status của mày. Messenger chỉ track và hiển thị status của người mày đã chat gần đây hoặc có trong friend list. Người lạ gửi friend request không biết mày có online không.

Scale optimization: thay vì broadcast status đến tất cả 1 tỷ user, chỉ maintain status visibility trong **social graph** của mày — vài trăm người. Fan-out giảm từ tỷ xuống vài trăm.

**Eventual consistency:**

Khi mày check status của bạn, request đến server "home" của họ — server quản lý connection của họ. Nếu họ vừa disconnect 10 giây trước ở một edge node khác, status update chưa kịp propagate. Mày thấy "online" trong khi họ đã tắt app rồi.

Đây là **eventual consistency** — hệ thống distributed không guarantee immediate consistency, chỉ guarantee cuối cùng sẽ consistent. Với online status, lag vài chục giây là acceptable.

## Mày thấy nó ở đâu trong thực tế

**WhatsApp "last seen"** dùng cùng heartbeat mechanism nhưng granularity khác: chỉ hiện khoảng thời gian ("last seen today at 3:45 PM"), không có "Active now" real-time cho người không phải contact thân thiết.

**Slack "presence":** Có thêm trạng thái "Away" tự động sau 30 phút không activity. Tích hợp với Google Calendar: đang có meeting thì Slack tự set "In a meeting". Phức tạp hơn Messenger vì workplace context đòi hỏi transparency hơn.

**Discord:** Online status có 4 mức: Online, Idle (không active >5 phút), Do Not Disturb, Invisible (offline giả). Invisible là user chủ động ẩn — server vẫn biết họ online nhưng không broadcast ra.

## Một dòng để nhớ

"Active now" không có nghĩa bạn mày đang nhìn vào màn hình — nó có nghĩa app đã gửi heartbeat trong vài phút gần đây, và Meta đã quyết định cho mày biết điều đó.

---
*Bài tiếp theo: Tại sao dark mode không chỉ là đổi màu background?*
