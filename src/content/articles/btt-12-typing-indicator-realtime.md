---
title: "Tại sao typing indicator hiện gần như realtime mà không spam server?"
description: "Dấu ba chấm '...' xuất hiện chỉ vài mili giây sau khi người kia bắt đầu gõ — nhưng nếu gửi event mỗi lần nhấn phím, server sẽ sập trong vài giây. Trick thật sự là throttle + timeout, và nó đơn giản hơn mày nghĩ."
category: system-design
pubDate: 2026-07-13
series: "Behind the Tech: Real-time"
tags: ["websocket", "real-time", "throttle", "messaging", "ux"]
---

Mày đang nhắn tin với ai đó, vừa thấy dấu ba chấm "Đang soạn tin..." hiện ra. Gần như ngay lập tức. Mày biết người kia đang gõ. Chờ thêm vài giây thì tin nhắn hiện ra, dấu chấm biến mất.

Nhìn tưởng đơn giản. Nhưng thử nghĩ lại: một người gõ nhanh có thể nhấn 5-10 phím mỗi giây. Nếu mỗi lần nhấn phím là một event gửi lên server, và app có vài trăm nghìn người đang nhắn tin đồng thời — server nhận bao nhiêu event mỗi giây? Tại sao nó không sập?

## Cách naive — tại sao nó không work

Cách đơn giản nhất là: mỗi khi user nhấn phím, bắn một WebSocket event `typing` lên server. Server nhận được thì broadcast sang tất cả người tham gia conversation. Gọn.

Vấn đề là tốc độ gõ trung bình của người dùng rơi vào khoảng 5-10 phím/giây. Với 200,000 người đang nhắn tin đồng thời, con số event mỗi giây là:

```
200,000 users × 7 phím/giây = 1,400,000 WebSocket events/giây
```

Đó là chưa kể server phải broadcast mỗi event sang những người khác trong conversation. Nếu mỗi conversation trung bình có 2 người, số lần broadcast nhân đôi. Server xử lý 2.8 triệu operations/giây chỉ để nói với người kia là "ừ nó đang gõ" — trong khi thông tin thật sự mày cần chỉ là: **đang gõ hay không đang gõ**, một bit thông tin nhị phân.

Gửi 10 event/giây để truyền tải một bit thông tin là lãng phí khủng khiếp. Cần cách khác.

## Cái trick thật sự đằng sau

Giải pháp thực tế dùng hai cơ chế kết hợp: **throttle** để giới hạn tần suất gửi event, và **timeout** để tự động phát hiện khi người dùng ngừng gõ.

```
User nhấn phím
     |
     v
[Đã đang "typing"?]
     |                    |
    CÓ                   KHÔNG
     |                    |
     | (bỏ qua)           v
     |             Gửi "typing_start"
     |             lên server
     |                    |
     v                    v
[Reset timeout 5s] <------+
     |
     | (nếu 5 giây không có phím nào mới)
     v
Gửi "typing_stop" lên server
```

Logic cụ thể:

**Khi user nhấn phím lần đầu:** gửi một event `typing_start` duy nhất lên server. Server broadcast sang những người còn lại trong conversation. Dấu ba chấm hiện ra phía họ.

**Throttle — khi user tiếp tục gõ:** nếu đã gửi `typing_start` trong vòng 2-3 giây gần đây, bỏ qua tất cả keypress tiếp theo. Không gửi thêm event nào. Giảm từ 10 event/giây xuống còn tối đa 1 event mỗi 2-3 giây.

**Timeout — phát hiện ngừng gõ:** mỗi lần user nhấn phím, reset một timer 5 giây. Nếu 5 giây trôi qua mà không có phím nào mới, timer kích hoạt và gửi event `typing_stop`. Server broadcast, dấu chấm biến mất.

Kết quả: thay vì 10 event/giây, mỗi user chỉ tạo ra tối đa 1 event mỗi 2-3 giây. Giảm 20-30 lần traffic.

## Đi sâu hơn — chi tiết kỹ thuật

Pseudo-code cho pattern này:

```javascript
let isTyping = false;
let typingTimeout = null;
const THROTTLE_INTERVAL = 2000; // ms
const STOP_TIMEOUT = 5000;      // ms

function onKeyPress() {
  // Throttle: chỉ gửi nếu chưa đang trong trạng thái typing
  if (!isTyping) {
    isTyping = true;
    sendWebSocketEvent({ type: "typing_start" });
  }

  // Reset timeout mỗi lần có phím mới
  clearTimeout(typingTimeout);
  typingTimeout = setTimeout(() => {
    isTyping = false;
    sendWebSocketEvent({ type: "typing_stop" });
  }, STOP_TIMEOUT);
}
```

Chú ý: đây là **throttle**, không phải **debounce**. Debounce sẽ chờ user ngừng gõ rồi mới gửi event đầu tiên — tức là dấu chấm sẽ không xuất hiện cho đến khi người kia dừng lại. Throttle thì ngược lại: gửi ngay lần đầu, sau đó chặn trong khoảng thời gian xác định. Đây là lý do typing indicator phản hồi gần như realtime.

**Phía server** xử lý đơn giản hơn nhiều: nhận `typing_start` thì broadcast trạng thái "đang gõ" cho những người còn lại trong conversation. Nhận `typing_stop` thì broadcast "dừng gõ". Không có database write nào cả — đây là **ephemeral state**, chỉ tồn tại trong RAM của server process, mất đi khi connection đóng hoặc timeout.

```
[Client A gõ]
     |
     | typing_start
     v
[WebSocket Server]
     |
     | broadcast "A đang gõ"
     v
[Client B, Client C, ...]
```

**Dấu ba chấm nhảy** là pure CSS animation, không liên quan gì đến network. Sau khi nhận được event "A đang gõ", client B tự render cái animation đó hoàn toàn phía local. Không có event nào được gửi từ A để "điều khiển" từng bước nhảy của dấu chấm.

```css
@keyframes typing-dot {
  0%, 60%, 100% { transform: translateY(0); }
  30% { transform: translateY(-6px); }
}
```

**Edge case quan trọng:** Nếu user đang gõ rồi đột ngột tắt app? Timeout 5 giây phía client sẽ không bao giờ chạy vì process đã chết. Kết quả: người kia thấy "đang soạn tin..." dai hơn thực tế — tối đa 5 giây, sau đó... mãi mãi.

Để xử lý case này, server cũng cần một timeout độc lập. Nếu không nhận thêm heartbeat nào từ client trong khoảng 10-15 giây (hoặc khi WebSocket connection đóng), server tự phát "typing_stop" cho conversation đó. Slight inaccuracy là chấp nhận được — không ai quan tâm đến 5-10 giây sai lệch trong typing indicator.

**Scale thêm:** Trong hệ thống có nhiều server nodes (horizontal scaling), `typing_start/stop` events cần được broadcast qua một message broker như Redis Pub/Sub, để server A có thể relay event sang clients đang connect ở server B. Đây là pattern phổ biến trong mọi realtime messaging system.

## Mày thấy nó ở đâu trong thực tế

**Messenger, WhatsApp, Telegram:** Tất cả đều dùng biến thể của pattern này. WhatsApp thêm một lớp: typing indicator chỉ hiển thị trong group chat nếu mày đang nhìn vào conversation đó, tránh spam notification cho group lớn.

**Slack:** Ngoài typing indicator, Slack còn dùng throttle tương tự cho "presence status" — cái chấm xanh lá cho biết người đó đang online. Thay vì gửi heartbeat mỗi giây, Slack gửi mỗi 30-60 giây, và tự động mark "away" sau vài phút không có activity.

**Google Docs:** Khi mày thấy cursor của người khác di chuyển trong document, đó cũng là throttled cursor position updates — không phải mỗi pixel di chuyển là một event.

**Những nơi mày không thấy nó nhưng nó vẫn ở đó:** Search autocomplete, live collaboration, online game presence systems — đều dùng throttle/debounce để kiểm soát tần suất gửi state updates.

## Một dòng để nhớ

Typing indicator realtime không phải vì server nhận data liên tục — mà vì client đủ thông minh để chỉ gửi khi trạng thái thật sự thay đổi.

---
*Bài tiếp theo: Tại sao notification push đến điện thoại dù app đang tắt?*
