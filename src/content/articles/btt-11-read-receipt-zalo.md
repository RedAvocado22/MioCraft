---
title: "Tại sao Zalo biết mày đã 'đọc' tin nhắn — read receipt hoạt động thế nào?"
description: "1 tick, 2 tick, tick xanh — Zalo biết chính xác lúc nào mày mở tin nhắn. Cơ chế đằng sau không phải là server hỏi thăm liên tục, mà là ACK packet đi ngược chiều."
category: system-design
pubDate: 2026-07-11
series: "Behind the Tech: Real-time"
tags: ["websocket", "messaging", "real-time", "read-receipt", "ux"]
---

Mày nhắn tin cho người yêu cũ lúc 11 giờ đêm. Một tick. Hai tick. Rồi tick xanh — 11:03, đã đọc. Sau đó im lặng. Mày biết họ đã thấy tin nhắn đó mà không trả lời.

Read receipt là một trong những tính năng gây stress nhất của ứng dụng nhắn tin hiện đại. Nhưng đằng sau cái tick xanh vô hại đó là một chuỗi sự kiện kỹ thuật phức tạp hơn mày nghĩ. Làm thế nào Zalo biết chính xác lúc nào mày mở tin nhắn — và làm điều đó cho hàng chục triệu người dùng cùng lúc mà không làm server vỡ?

## Cách naive — tại sao nó không work

Cách đầu tiên nghĩ đến: người gửi định kỳ hỏi server "người kia đọc chưa?". Mỗi vài giây poll một lần, server tra DB trả về trạng thái.

Thử tính: 10 triệu user đang active, mỗi người có 5 conversation đang mở, poll mỗi 2 giây. Đó là **25 triệu HTTP request mỗi giây** — chỉ để hỏi "có ai đọc chưa?". Server cost sẽ không tưởng, latency sẽ tệ, và kết quả vẫn có độ trễ 2 giây.

Tăng tần suất poll để giảm delay? Mọi thứ chỉ tệ hơn. Đây là lý do polling không scale cho real-time feature.

## Cái trick thật sự đằng sau

Read receipt không phải là server liên tục *kiểm tra* — mà là client liên tục *báo cáo*. Khi có sự kiện xảy ra, thiết bị tự chủ động gửi một **ACK packet** nhỏ lên server, server relay cho người kia.

Ba trạng thái, ba sự kiện riêng biệt:

```
Người gửi (A)              Server                 Người nhận (B)
     |                        |                         |
     |--- gửi message ------->|                         |
     |                        |-- lưu DB               |
     |<-- ACK "sent" ---------|                         |
     |   (1 tick)             |-- push to B's device -->|
     |                        |                    B nhận được
     |                        |<-- ACK "delivered" -----|
     |<-- relay "delivered" --|                         |
     |   (2 tick)             |                         |
     |                        |               B mở conversation
     |                        |<-- ACK "read" ----------|
     |<-- relay "read" -------|                         |
     |   (tick xanh)          |                         |
```

Không có bước nào server chủ động poll. Mọi thứ đều **event-driven** — chỉ gửi packet khi có việc thực sự xảy ra.

**Kết nối nền là WebSocket** — một persistent connection TCP, giữ mở liên tục giữa app và server. Không giống HTTP request-response thông thường phải mở connection mới mỗi lần, WebSocket handshake một lần rồi hai chiều truyền data thoải mái. ACK packet nhỏ vài byte đi qua channel này gần như tức thì.

## Đi sâu hơn — chi tiết kỹ thuật

**"Đọc" nghĩa là gì ở tầng code?**

Không phải message chỉ cần *được nhận* — nó cần *được người dùng thực sự nhìn thấy*. Đây là phần thú vị.

Trên **web** (Zalo Web, WhatsApp Web): dùng `IntersectionObserver` API — browser native API theo dõi khi một element xuất hiện trong viewport. App đăng ký observer cho mỗi message bubble. Khi message scroll vào tầm nhìn *và* tab đang active (`document.hasFocus()` = true) → fire "read" event → gửi ACK.

```javascript
const observer = new IntersectionObserver((entries) => {
  entries.forEach(entry => {
    if (entry.isIntersecting && document.hasFocus()) {
      sendReadAck(entry.target.dataset.messageId);
      observer.unobserve(entry.target); // chỉ cần trigger một lần
    }
  });
}, { threshold: 0.5 }); // ít nhất 50% message phải hiện
```

Trên **iOS**: check `UIApplication.shared.applicationState == .active` và app ở foreground. Khi mày switch tab sang app khác, state = `.background`, read ACK không được gửi.

Trên **Android**: tương tự với `AppLifecycleState`. Notification read (mày đọc từ notification tray mà không mở app) cũng có thể trigger read receipt tùy app.

**Điều kiện để gửi "read" ACK:**
1. App đang foreground (không bị minimize)
2. Conversation đang mở (không chỉ chat list)
3. Message nằm trong visible area (đã scroll đến)

Mày mở Zalo, nhưng đang đọc conversation khác? Tin nhắn trong conversation bị ẩn không được mark as read. Đây là lý do đôi khi mày thấy "đã giao" mãi không chuyển sang "đã đọc" dù người kia đang online.

**Multiple devices:** Nếu mày đăng nhập cả phone lẫn Zalo Web, read ACK từ bất kỳ thiết bị nào cũng đủ để mark message là đã đọc. Server lưu trạng thái per-message, không per-device.

**Message delivery khi offline:** Server lưu tin nhắn. Khi thiết bị của B reconnect (mở app sau khi tắt), server gửi tất cả pending messages. Device nhận xong, gửi bulk "delivered" ACK. Đây là lý do đôi khi mày thấy cả đống tin nhắn đột ngột chuyển sang 2 tick cùng lúc — người kia vừa mở app sau vài tiếng offline.

**Tại sao không dùng Server-Sent Events hoặc long polling?** WebSocket là bidirectional — cả hai chiều đều dùng chung một connection. SSE chỉ server → client. Long polling có overhead lớn hơn mỗi lần reconnect. Với messaging app cần gửi nhận liên tục, WebSocket là lựa chọn tự nhiên nhất.

## Mày thấy nó ở đâu trong thực tế

**WhatsApp** implement read receipt giống nhau nhưng có thêm tùy chọn tắt hoàn toàn trong Settings → Privacy → Read Receipts. Khi tắt, app đơn giản là không gửi "read" ACK lên server — bên kia mãi thấy 2 tick xám. Đổi lại, mày cũng không thấy read receipt của người khác (two-way).

**iMessage** còn granular hơn: mày có thể tắt read receipt globally hoặc per-contact. Per-contact setting được lưu local trên device, không phải server.

**Slack và Discord** dùng cơ chế tương tự nhưng scope khác: thay vì per-message, họ track **"đã đọc đến tin nhắn nào"** trong một channel — lưu một `last_read_message_id` per user per channel. Hiệu quả hơn cho group chat vì không cần ACK cho từng tin nhắn riêng lẻ, chỉ cần update cursor position khi người dùng scroll channel.

## Một dòng để nhớ

Read receipt hoạt động không phải vì server hỏi thăm mày liên tục — mà vì điện thoại của mày chủ động báo cáo đúng lúc mày thực sự nhìn vào màn hình.

---
*Bài tiếp theo: Tại sao typing indicator hiện gần như realtime mà không spam server?*
