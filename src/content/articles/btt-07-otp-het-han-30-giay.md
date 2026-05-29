---
title: "Tại sao OTP chỉ dùng được một lần và hết hạn sau 30 giây?"
description: "Cái mã 6 số trong Google Authenticator không được tạo ra từ server — điện thoại của mày tự tính nó mà không cần internet. TOTP là thứ đứng sau tất cả."
category: system-design
pubDate: 2026-07-09
series: "Behind the Tech: Auth & Security"
tags: ["otp", "totp", "authentication", "security", "hmac", "2fa"]
---

Mày bật 2FA, mở Google Authenticator, thấy một dãy 6 số đang đếm ngược. 27 giây. 26 giây. 25 giây. Mày copy vội, dán vào trang web, nhấn xác nhận — qua. Nhưng thử dùng lại cái mã đó 5 phút sau? Báo sai ngay.

Rõ ràng cái mã này không tồn tại mãi. Nhưng ai tạo ra nó? Server gửi cho điện thoại mày à? Và nếu không có mạng mà Authenticator vẫn hiện mã — thì mã đó đến từ đâu?

## Cách naive — tại sao nó không work

Cách đơn giản nhất ai cũng nghĩ đến: server tạo ra một mã ngẫu nhiên, lưu vào database kèm thời gian hết hạn, gửi cho mày qua SMS hoặc app, mày nhập lại, server tra DB kiểm tra.

Cách này thực ra là SMS OTP đang làm — và nó có vài vấn đề nghiêm trọng:

**Replay attack:** Nếu ai đó chặn được mã OTP của mày (SIM swap, SS7 attack, man-in-the-middle), họ có thể dùng nó trong khoảng thời gian còn hiệu lực. 10 phút đủ để làm nhiều thứ.

**DB lookup mỗi lần xác thực:** Server phải lưu trữ và tra cứu từng mã cho từng user mỗi lần verify. Với hàng triệu user đang đăng nhập, đây là database bottleneck lớn.

**Phụ thuộc vào kênh gửi:** SMS có thể bị delay, bị chặn, hoặc mày đang ở vùng không sóng. Cái app Authenticator của mày thì không cần mạng — và đó chính là hint cho cơ chế thật sự.

## Cái trick thật sự đằng sau

Google Authenticator không nhận mã từ server. Nó **tự tính mã** — và server cũng **tự tính mã đó** — rồi cả hai so sánh kết quả. Không cần giao tiếp gì thêm.

Đây là **TOTP — Time-based One-Time Password**, được chuẩn hóa trong RFC 6238. Nguyên lý:

```
Shared Secret (thiết lập một lần)
         |
         +-----> [Phone]  HMAC-SHA1(secret, time_counter) → 6 digits
         |
         +-----> [Server] HMAC-SHA1(secret, time_counter) → 6 digits
                                         ↑
                          time_counter = floor(unix_timestamp / 30)
```

Cả hai bên dùng cùng hai input: **secret key** và **time counter**. Cùng input → cùng output. Không cần trao đổi mã qua mạng.

**Time counter** là thứ làm mã thay đổi mỗi 30 giây:

```
time_counter = floor(unix_timestamp / 30)
```

Lúc 12:00:00 → timestamp = 1749600000 → counter = 58320000
Lúc 12:00:29 → timestamp = 1749600029 → counter = 58320000  (vẫn như cũ)
Lúc 12:00:30 → timestamp = 1749600030 → counter = 58320001  (đổi!)

Counter thay đổi → input đổi → HMAC output đổi → mã 6 số đổi.

**HMAC-SHA1** là hàm hash một chiều: biết input thì tính được output, nhưng từ output không ngược ra được input. Nếu ai thấy mã "482931", họ không thể suy ngược ra secret key.

Từ HMAC output (20 bytes), TOTP lấy **dynamic truncation**: đọc 4 bytes tại offset xác định, bỏ bit đầu, lấy modulo 1.000.000 → ra 6 chữ số.

## Đi sâu hơn — chi tiết kỹ thuật

**Cái QR code mày scan khi setup 2FA** không chứa mã OTP. Nó chứa **secret key**, được encode theo format:

```
otpauth://totp/Google%3Amay%40gmail.com?secret=JBSWY3DPEHPK3PXP&issuer=Google
```

`JBSWY3DPEHPK3PXP` là secret key encode bằng Base32. Authenticator giải mã ra byte array, lưu an toàn trong secure storage của điện thoại. Từ đó về sau, mọi mã OTP đều được tính offline hoàn toàn từ secret này.

**Vấn đề clock skew:** Điện thoại và server đồng hồ không hoàn toàn khớp nhau. Nếu điện thoại chậm 15 giây, mã tính ra có thể thuộc time window cũ. Để giải quyết, server thường chấp nhận **±1 window** — tức là mã của window liền trước và liền sau cũng pass. Thực tế mày có khoảng 90 giây để nhập mã dù UI hiển thị là 30 giây.

**Tại sao dùng được một lần?** Server theo dõi time counter cuối cùng đã dùng thành công. Nếu mày submit mã của counter N, server lưu lại "đã dùng counter N rồi". Submit lần hai với cùng mã trong window đó → reject. Counter tiếp theo (N+1) mới được chấp nhận.

**HOTP vs TOTP:** TOTP (Time-based) là phiên bản cải tiến của HOTP (HMAC-based OTP, RFC 4226). HOTP dùng **counter tăng dần** (0, 1, 2, 3...) thay vì time. Vấn đề: counter có thể lệch nhau nếu người dùng generate nhiều mã mà không dùng. TOTP dùng thời gian là nguồn counter tự nhiên và đồng bộ, giải quyết vấn đề này.

**SMS OTP khác hoàn toàn:** Đây là server tạo random token, lưu DB, gửi qua telco network. Không có shared secret, không có HMAC. Yếu hơn TOTP vì phụ thuộc vào SMS infrastructure và có thể bị intercept qua SIM swap hay SS7 exploit.

## Mày thấy nó ở đâu trong thực tế

**Google Authenticator, Authy, Microsoft Authenticator** đều implement TOTP. Authy có thêm cloud backup encrypted secret — tiện hơn nhưng trust model phức tạp hơn vì secret không còn chỉ tồn tại trên device của mày.

**GitHub, AWS, Cloudflare** đều support TOTP 2FA. Khi mày mất điện thoại, backup codes họ cấp lúc setup thực ra là pre-generated one-time tokens — không phải TOTP, chỉ là random tokens lưu server để dùng emergency.

**YubiKey và hardware security keys** đi xa hơn TOTP: dùng FIDO2/WebAuthn với public-key cryptography, private key không bao giờ rời khỏi thiết bị vật lý, chống phishing hoàn toàn vì credential bị bind với domain. Nhưng TOTP vẫn là tiêu chuẩn phổ biến nhất cho consumer apps vì setup đơn giản hơn nhiều.

## Một dòng để nhớ

OTP hết hạn không phải vì server thu hồi nó — mà vì thời gian là một phần của công thức, và thời gian không đi ngược.

---
*Bài tiếp theo: Tại sao HTTPS không bị nghe lén dù đi qua hàng chục server?*
