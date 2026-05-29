---
title: "Tại sao QR code thanh toán hết hạn sau vài phút?"
description: "QR code của MoMo không chứa số tài khoản của mày — nó chứa một session token có chữ ký mật mã. Đây là thứ ngăn kẻ xấu chụp màn hình rồi thanh toán lại."
category: system-design
pubDate: 2026-07-18
series: "Behind the Tech: Payments"
tags: ["payments", "qr-code", "security", "session", "idempotency"]
---

Mày mở MoMo, chọn "Nhận tiền", cái QR code hiện ra. Góc màn hình có đồng hồ đếm ngược: 4:59... 4:58... 4:57. Hết 5 phút, QR code refresh thành cái mới.

Sao phải vậy? QR code bình thường — kiểu in trên menu nhà hàng — tồn tại mãi mãi. Tại sao QR thanh toán lại expire? Và nếu ai đó chụp màn hình QR của mày trước khi nó hết hạn, họ có thanh toán được không? Câu trả lời là không — và lý do tại sao thú vị hơn mày nghĩ.

## Cách naive — tại sao nó không work

Cách đơn giản nhất: QR code encode thẳng số tài khoản và số tiền.

```
Ví dụ naive: QR chứa "MOMO:0912345678:100000"
```

Quét → app đọc số tài khoản → chuyển tiền. Static, đơn giản, không cần server khi quét.

Vấn đề: cái QR đó **không bao giờ thay đổi**. Ai chụp lại màn hình của mày, họ có thể quét nó một tuần sau và chuyển tiền y hệt. Hoặc tệ hơn:

**Replay attack tại cửa hàng vật lý:** Khách hàng thanh toán 200k xong, chụp lại QR trên quầy thu ngân, tối về quét lại — lần hai cũng success. Merchant mất tiền.

**QR giả mạo:** Kẻ tấn công in QR của tài khoản mình dán đè lên QR của quán ăn. Khách quét, tiền vào tài khoản kẻ tấn công chứ không phải chủ quán. (Vụ này đã xảy ra thực tế ở Singapore, Trung Quốc.)

Cần một cơ chế để QR chỉ dùng được một lần, trong một khoảng thời gian ngắn.

## Cái trick thật sự đằng sau

QR code thanh toán không encode thông tin tài khoản. Nó encode một **session token** — một chuỗi ngẫu nhiên đại diện cho một phiên thanh toán cụ thể tồn tại trên server.

Khi mày mở màn hình "Nhận tiền":

```
1. App gọi API: POST /payment/create-session
   Body: { user_id: "mao123", amount: null (hoặc cố định) }

2. Server tạo payment session:
   {
     session_id: "a3f8c291b47e9d05",
     user_id: "mao123",
     amount: null,
     created_at: 1748600000,
     expires_at: 1748600300,  // +5 phút
     status: "PENDING"
   }
   Lưu vào DB, return session_id

3. App encode QR:
   "https://pay.momo.vn/qr?s=a3f8c291b47e9d05"
```

Khi người kia quét QR:

```
1. App quét → đọc URL → extract session_id: "a3f8c291b47e9d05"

2. App gọi API: GET /payment/session/a3f8c291b47e9d05

3. Server validate:
   - Session tồn tại? ✓
   - expires_at > now? ✓ (còn 3 phút)
   - status == "PENDING"? ✓
   → Trả về thông tin: tên người nhận, số tiền

4. Người dùng xác nhận → POST /payment/execute
   Server:
   - Validate lại (có thể bị race condition)
   - Debit người gửi, credit người nhận
   - UPDATE session SET status = "USED"

5. Quét lại QR đó: status == "USED" → reject
```

**Session token là ngẫu nhiên và không đoán được**: `a3f8c291b47e9d05` là 16 ký tự hex, tức 64 bits entropy. Brute force hết 18 quintillion khả năng — không khả thi.

**Expiry giới hạn attack window**: Ngay cả khi ai đó capture được token, họ chỉ có 5 phút để dùng, không phải vô hạn thời gian.

## Đi sâu hơn — chi tiết kỹ thuật

**Cryptographic signature** — nhiều hệ thống không chỉ dùng random token mà còn **ký** nó. Token trông như:

```
a3f8c291b47e9d05.1748600000.HMAC_SHA256(secret_key, "a3f8c291b47e9d05:1748600000")
```

Ba phần: session_id + timestamp + signature. Khi scanner nhận token:
1. Tách ra ba phần
2. Tính lại HMAC với secret key của server
3. So sánh với signature trong token

Nếu khớp → token authentic, không bị giả mạo. Server có thể validate mà **không cần DB lookup** cho bước đầu — chỉ cần verify chữ ký. DB lookup chỉ cần ở bước thứ hai để check xem đã dùng chưa.

**Idempotency** là property quan trọng: mỗi payment session chỉ dẫn đến đúng một giao dịch, dù execute được gọi bao nhiêu lần. Status `USED` là cờ idempotency. Hệ thống thanh toán nghiêm túc còn dùng database-level unique constraint trên session_id để tránh race condition khi hai request arrive simultaneously.

**Dynamic QR vs Static QR** — hai loại khác nhau:

```
Dynamic QR: server generate, có session_id, có expiry
  → Dùng để nhận tiền theo từng giao dịch cụ thể
  → QR thay đổi mỗi lần
  → Số tiền baked in từ đầu (hoặc người gửi nhập)

Static QR: encode cố định thông tin merchant
  → In ra giấy, dán ở quầy thu ngân
  → Không bao giờ expire
  → Người gửi PHẢI nhập số tiền
  → Merchant ID + bank ID, không phải account number trực tiếp
```

Static QR an toàn hơn static-account QR vì nó chỉ chứa merchant reference, không phải số tài khoản thật. Server resolve merchant reference → account. Kẻ giả mạo có thể dán QR của mình lên, nhưng QR đó phải được đăng ký với ngân hàng — có audit trail.

**NAPAS và tiêu chuẩn VietQR** ở Việt Nam: tất cả QR thanh toán ngân hàng dùng format VietQR chuẩn hóa bởi NAPAS, embed EMVCo QR spec. Session token nằm trong field "Additional Data" của EMV format. Đây là lý do mày có thể quét QR MoMo bằng app ngân hàng Vietcombank và nó vẫn hiểu được.

**Tấn công screenshot thực tế** hoạt động như thế nào:

```
Kịch bản không có expiry:
T+0:   Mày tạo QR nhận 500k
T+10s: Người kia quét, chuyển 500k ✓
T+1h:  Kẻ xấu dùng screenshot QR cũ quét lại → 500k nữa ✓ (nếu không có "USED" check)

Kịch bản có expiry + idempotency:
T+0:   Mày tạo QR nhận 500k (expires T+5m)
T+10s: Người kia quét, chuyển 500k ✓, session → USED
T+20s: Ai đó dùng screenshot quét lại → status USED → reject ✓
T+6m:  Ai đó dùng screenshot quét lại → expired → reject ✓
```

## Mày thấy nó ở đâu trong thực tế

**MoMo, VNPay, ZaloPay** — tất cả đều dùng session-based QR với expiry. Thời gian expire khác nhau: MoMo 5 phút, một số ngân hàng 10 phút, VietQR tĩnh không expire.

**Stripe, PayPal** dùng cơ chế tương tự cho payment link — link thanh toán có expiry, một lần dùng.

**Vé điện tử** (concert, máy bay) dùng QR với signature nhưng thường không expire theo thời gian — thay vào đó được mark USED sau khi quét tại cổng vào. Nếu quét hai lần, lần hai bị reject.

**Login QR** (kiểu Zalo Web, WeChat Web) cũng dùng pattern tương tự: QR chứa session token, desktop browser poll server để biết khi nào mobile app confirm, session expire nhanh vì security.

## Một dòng để nhớ

QR thanh toán expire không phải vì kỹ thuật khó — mà vì cái cửa sổ thời gian nhỏ là thứ duy nhất đứng giữa mày và kẻ replay attack của mày.

---
*Bài tiếp theo: Tại sao ảnh trên web hiện đại nhỏ hơn nhưng vẫn đẹp?*
