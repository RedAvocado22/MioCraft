---
title: "Tại sao xe Grab trên map chạy mượt dù không gọi API mỗi giây?"
description: "Icon xe Grab di chuyển mượt 60fps trên map của mày — nhưng thực ra nó chỉ nhận dữ liệu GPS mỗi 3-5 giây. Cái trick đằng sau là dead reckoning, kỹ thuật dẫn đường mà NASA dùng từ thập niên 60."
category: system-design
pubDate: 2026-07-01
series: "Behind the Tech: App & UX"
tags: ["websocket", "dead-reckoning", "real-time", "maps", "mobile"]
---

Mày đặt Grab, nhìn vào map, thấy cái icon xe máy đang lướt đều đặn về phía mày. Nó xoay theo đúng hướng rẽ, trôi mượt qua từng khúc đường, không giật không lag. Nhìn xong mày nghĩ: "Ừ bình thường thôi, app nó cập nhật GPS liên tục mà."

Nhưng thử nghĩ lại: nếu driver gửi vị trí mỗi giây, và mày đang ngồi chờ xe trong khi đang dùng 4G... cái icon đó tiêu tốn bao nhiêu data, bao nhiêu pin, bao nhiêu server request? Và nếu nó chỉ cập nhật mỗi 3-5 giây, tại sao animation lại mượt đến vậy — thay vì nhảy cóc từng đoạn?

> **TL;DR:** App Grab chỉ nhận GPS update mỗi 3-5 giây — không phải mỗi frame. Giữa hai update, app **tự tính toán** vị trí tiếp theo dựa vào tốc độ và hướng đã biết. Kỹ thuật này gọi là dead reckoning — NASA dùng nó để dẫn đường tàu vũ trụ từ thập niên 60.

## Cách naive — tại sao nó không work

Cách đầu tiên ai cũng nghĩ đến: driver app gửi GPS coordinates lên server mỗi giây, server push xuống passenger app, passenger app cập nhật vị trí icon trên map.

Vấn đề là cách này fail ở mọi mặt:

**Battery drain:** GPS là module ngốn pin nhất trên điện thoại. Đọc GPS liên tục + gửi network request mỗi giây = pin driver cạn trong 2-3 tiếng. Driver không ai chịu chạy app như vậy.

**Network overhead:** Mỗi GPS update là một HTTP request — header, authentication, payload. Với 1 triệu driver đang online, đó là 1 triệu request/giây chỉ để update vị trí. Server cost sẽ điên rồ.

**Vẫn còn giật:** Ngay cả khi mày cập nhật mỗi giây, animation vẫn không mượt. Giữa hai vị trí cách nhau 1 giây, icon vẫn phải "nhảy" thay vì trôi. 60fps animation cần 60 frames/giây — không có cách nào poll API đủ nhanh để làm được điều đó.

Polling thêm dày chỉ làm vấn đề tệ hơn, không giải quyết được gốc rễ.

## Cái trick thật sự đằng sau

Grab dùng hai thứ kết hợp: **WebSocket** để giảm tần suất update, và **dead reckoning** để lấp đầy khoảng trống.

```
[Driver GPS]                    [Passenger App]
     |                                |
     | position + velocity + heading  |
     |-----> WebSocket --> Server --> | (mỗi 3-5 giây)
     |                                |
     |                    dead reckoning loop (60fps)
     |                    pos = last_pos + velocity × Δt
     |                                |
     | GPS update mới                 | reconcile smoothly
     |-----> WebSocket --> Server --> | ease to new position
```

**WebSocket** thay vì HTTP polling: connection được duy trì liên tục, không có overhead của việc mở connection mới mỗi lần. Driver gửi một packet nhỏ mỗi 3-5 giây là đủ.

**Dead reckoning** là kỹ thuật dự đoán vị trí hiện tại dựa vào vị trí đã biết + hướng di chuyển + tốc độ + thời gian đã trôi qua. Tên nghe fancy nhưng concept đơn giản:

> Tao biết lúc T=0, xe ở điểm A, đang đi hướng Bắc với tốc độ 40km/h. Bây giờ là T=2 giây. Vậy xe đang ở khoảng A + 22 mét về phía Bắc.

Passenger app nhận được mỗi GPS update không chỉ có coordinates, mà còn có **velocity vector** (tốc độ + hướng). Từ đó, app tự tính ra 60+ intermediate positions để render animation mượt — không cần hỏi server thêm lần nào.

**requestAnimationFrame** là vòng lặp render của browser/app chạy mỗi ~16ms (tức 60fps). Mỗi frame, app tính lại dead reckoning position và cập nhật icon. Vì là pure math trên client, không có network latency, animation cực mượt.

## Nếu bạn muốn hiểu sâu hơn _(đọc thêm, không bắt buộc)_

Packet driver gửi lên trông roughly như thế này:

```json
{
  "driver_id": "drv_abc123",
  "timestamp": 1719820800000,
  "lat": 10.7769,
  "lng": 106.7009,
  "speed": 11.2,
  "heading": 274.5,
  "accuracy": 4.2
}
```

`heading` là góc tính từ North clockwise (0° = North, 90° = East, 180° = South, 270° = West). `speed` tính bằng m/s. Với hai thông số này, client có đủ dữ liệu để dead reckoning.

Dead reckoning formula:

```
new_lat = last_lat + (speed × cos(heading) × Δt) / EARTH_RADIUS
new_lng = last_lng + (speed × sin(heading) × Δt) / (EARTH_RADIUS × cos(last_lat))
```

Trong đó `Δt` là số giây kể từ lần update cuối. Mỗi frame của `requestAnimationFrame` tính lại `Δt` mới → icon di chuyển mượt.

**Vấn đề reconciliation:** Khi GPS update thật sự đến, vị trí thật có thể khác với vị trí dead reckoning dự đoán (vì tốc độ thay đổi, rẽ bất ngờ...). Nếu teleport icon thẳng đến vị trí thật, người dùng sẽ thấy giật. Thay vào đó, app dùng **easing interpolation** — dịch chuyển icon từ từ sang vị trí mới trong khoảng 500ms-1s, người dùng không nhận ra sự chênh lệch.

**GPS accuracy field** cũng quan trọng: khi accuracy kém (xe trong hầm, tòa nhà), app giảm tin tưởng vào dead reckoning và hiển thị indicator "đang tìm vị trí". Tránh việc icon chạy lung tung dựa trên dữ liệu rác.

## Mày thấy nó ở đâu trong thực tế

**Google Maps navigation:** Khi mày đang chỉ đường, mũi tên vị trí của mày di chuyển mượt ngay cả khi GPS signal yếu hoặc update chậm. Đúng cơ chế dead reckoning, nhưng Google còn kết hợp thêm accelerometer và gyroscope từ IMU của điện thoại để dead reckoning chính xác hơn nhiều — gọi là **sensor fusion**.

**Multiplayer games:** Trong các game bắn súng online như PUBG Mobile, nhân vật của đối thủ di chuyển mượt dù packet chỉ đến mỗi 50-100ms. Client dùng dead reckoning kết hợp với **client-side prediction** — mày thấy nhân vật đối thủ di chuyển theo quán tính, rồi "snap" về vị trí thật khi server packet đến. Đây là lý do đôi khi mày bắn trúng nhưng vẫn miss — client và server có vị trí khác nhau.

**Uber Eats, ShopeeFood:** Shipper icon trên map dùng cùng kỹ thuật. Điểm khác biệt: các app giao đồ ăn thường dùng update interval dài hơn (5-10 giây) vì shipper đi bộ hoặc chạy chậm hơn xe máy Grab, dead reckoning vẫn đủ chính xác.

## Một dòng để nhớ

Animation mượt không đến từ việc nhận data nhiều hơn — mà từ việc client đủ thông minh để tự suy ra những gì server chưa kịp gửi.

---
*Bài tiếp theo: Tại sao ảnh Instagram load từ mờ đến rõ thay vì hiện trắng rồi bật ra?*
