---
title: "Tại sao notification push đến điện thoại dù app đang tắt?"
description: "Zalo gửi tin nhắn lúc 2 giờ sáng, điện thoại mày rung dù app đã tắt hoàn toàn. Không phải app đang ngầm chạy — mà OS đang duy trì một kết nối TCP thay cho tất cả app. Đây là cách FCM và APNs hoạt động."
category: system-design
pubDate: 2026-07-14
series: "Behind the Tech: Real-time"
tags: ["push-notifications", "fcm", "apns", "mobile", "real-time"]
---

2 giờ sáng. Điện thoại mày rung. Notification Zalo hiện ra: tin nhắn mới từ ai đó. Mày mở ra đọc, rồi tắt màn hình ngủ tiếp. Cũng bình thường thôi.

Nhưng khoan — app Zalo không chạy. Mày đã swipe nó đi từ tối qua. Điện thoại đang ở chế độ tiết kiệm pin, màn hình tắt. Vậy cái gì đã "nghe" được tin nhắn đó và đánh thức điện thoại mày lên? Nếu không phải app, thì là cái gì?

## Cách naive — tại sao nó không work

Cách đầu tiên mà bất kỳ developer nào cũng nghĩ đến: cho app chạy background và poll server định kỳ. Cứ mỗi 1 phút, app thức dậy, hỏi server "có tin mới không?", nhận response, rồi ngủ lại.

Vấn đề là cách này tệ theo nhiều cách:

**Pin cạn nhanh:** Mỗi lần poll là một lần radio chip (4G/WiFi) bật lên, thiết lập TCP connection, gửi request, nhận response, đóng connection. Chuỗi này tốn điện đáng kể. Với 50 app đều poll mỗi phút, điện thoại chạy đến trưa là hết pin.

**Notification đến chậm:** Poll mỗi phút → notification có thể đến trễ tới 59 giây. Kém hơn là mày tự giảm interval xuống 10 giây — nhưng lúc đó pin cạn còn nhanh hơn.

**OS không cho phép:** Cả Android lẫn iOS đều có cơ chế giới hạn background app activity. Doze mode (Android) và App Background Refresh (iOS) throttle hoặc suspend app hoàn toàn khi điện thoại không dùng. App tự poll sẽ bị OS chặn.

Polling không scale. Cần một cơ chế khác hoàn toàn.

## Cái trick thật sự đằng sau

Giải pháp là để **OS** duy trì connection thay vì từng app riêng lẻ. Đây là lý do FCM (Firebase Cloud Messaging) và APNs (Apple Push Notification service) tồn tại.

```
[Backend của Zalo]
        |
        | HTTPS API call
        | "Gửi notification đến device token ABC"
        v
[FCM Server (Google) / APNs (Apple)]
        |
        | Persistent TCP connection
        | (duy trì bởi OS, không phải app)
        v
[OS trên điện thoại mày]
        |
        | OS đánh thức app hoặc
        | hiển thị notification trực tiếp
        v
[Notification hiển thị]
```

**Phía điện thoại:** OS duy trì MỘT kết nối TCP liên tục đến FCM server (Android) hoặc APNs server (iOS). Không phải mỗi app giữ connection riêng — tất cả app chia sẻ chung một connection này. Kết nối được OS quản lý, tối ưu pin, và không bị app lifecycle ảnh hưởng.

**Device token** là định danh duy nhất cho một app cụ thể trên một thiết bị cụ thể. Khi Zalo lần đầu cài lên điện thoại mày, nó đăng ký với FCM và nhận về một token trông như thế này:

```
fXj8kL2mNpQrStUvWxYz:APA91bH7...
```

Zalo gửi token này lên server của Zalo, kèm theo account của mày. Server lưu lại: "user Nguyễn Văn A → device token XYZ".

**Khi có notification cần gửi:** Server Zalo gọi FCM API:

```json
POST https://fcm.googleapis.com/v1/projects/zalo/messages:send
{
  "message": {
    "token": "fXj8kL2mNpQrStUvWxYz:APA91bH7...",
    "notification": {
      "title": "Tin nhắn mới",
      "body": "Mày ơi..."
    }
  }
}
```

FCM nhận request, tìm connection đang active cho device token đó, push message xuống qua persistent TCP connection. OS điện thoại mày nhận được, hiển thị notification, và tùy config thì đánh thức app hoặc không.

## Đi sâu hơn — chi tiết kỹ thuật

**High-priority vs Normal-priority notification** là phân biệt quan trọng mà ít người biết.

High-priority (Android) / Alert notification (iOS): đánh thức thiết bị ngay lập tức, ngay cả khi đang ở Doze mode hoặc màn hình tắt. Dùng cho tin nhắn mới, cuộc gọi đến — những thứ user cần biết ngay.

Normal-priority: batched lại, gửi khi thiết bị tự thức dậy để sync. Có thể trễ vài phút đến vài chục phút. Dùng cho background sync, update dữ liệu không khẩn cấp.

```
High-priority:
  Backend → FCM → [WAKE DEVICE NOW] → notification ngay

Normal-priority:
  Backend → FCM → [queue] → device tự thức → notification sau
```

**Silent push** là tính năng ít được biết đến: notification không hiển thị gì cho user nhưng vẫn đánh thức app để chạy code ngầm. Zalo dùng silent push để sync danh sách tin nhắn chưa đọc khi app đang đóng — khi mày mở app lên, data đã ready thay vì phải load từ đầu. Typing indicator giữa các thiết bị (ví dụ mày nhắn trên web, điện thoại hiện "đang soạn") cũng đi qua silent push.

**Device token thay đổi** khi nào? Khi user reinstall app, khi reset factory, khi uninstall/install lại. Backend phải handle case này: nếu FCM trả về lỗi "invalid token", server phải xóa token cũ và chờ app gửi token mới khi được mở lại. Nếu không clean up, backend tích lũy hàng triệu stale tokens.

**End-to-end encryption và privacy:** FCM/APNs thấy metadata (đến thiết bị nào, lúc mấy giờ) nhưng không đọc được payload nếu app dùng E2E encryption. Signal, WhatsApp khi bật E2E: notification chỉ chứa "Mày có tin nhắn mới" — nội dung thật sự được fetch trực tiếp từ server của app sau khi mở lên, không đi qua FCM payload.

```
[Payload qua FCM — FCM thấy được]
{
  "notification": { "title": "Tin nhắn mới" }
}

[Payload E2E encrypted — FCM không đọc được]
{
  "data": {
    "encrypted_payload": "U2FsdGVkX1+7mK9..."
  }
}
```

**Tại sao iOS và Android dùng hai hệ thống khác nhau?** Apple kiểm soát toàn bộ stack phần cứng và phần mềm của iOS, nên APNs được tích hợp sâu vào OS. Google không thể làm vậy với Android vì Android chạy trên hàng nghìn thiết bị từ nhiều nhà sản xuất — FCM là giải pháp cross-device của Google, nhưng nó yêu cầu Google Play Services. Tại Trung Quốc, nơi không có Google Play, mỗi vendor (Huawei, Xiaomi, Oppo) có push service riêng (HMS Push, Mi Push, OPPO Push).

## Mày thấy nó ở đâu trong thực tế

**Zalo, Facebook Messenger:** Dùng FCM/APNs làm delivery channel. Payload thường chỉ là trigger — app fetch nội dung thật từ server riêng để tránh lộ thông tin qua Google/Apple.

**App ngân hàng:** OTP, cảnh báo giao dịch đều là high-priority notification. Thú vị là nhiều ngân hàng Việt Nam dùng cả SMS lẫn push notification song song — SMS là fallback khi app chưa cài hoặc notification bị tắt.

**Email client (Gmail, Outlook):** Normal-priority notification, batched để tiết kiệm pin. Lý do Gmail đôi khi báo mail chậm vài phút so với thực tế.

**Game mobile:** "Năng lượng của mày đã đầy", "Bạn bè mày vừa tấn công thành" — những notification này được schedule sẵn trên server và gửi qua FCM vào đúng thời điểm, ngay cả khi game đóng từ lâu.

## Một dòng để nhớ

Notification không phải app mày đang nghe — mà là OS đang nghe thay cho mày, và chỉ đánh thức app khi có thứ đáng để xem.

---
*Bài tiếp theo: Tại sao game online biết vị trí nhân vật của người khác gần như realtime?*
