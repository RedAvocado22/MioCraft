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

> **TL;DR:** Điện thoại và server đều **tự tính toán** mã OTP từ cùng một công thức — dùng một secret key chung và thời gian hiện tại. Không cần gửi mã qua mạng. Cứ mỗi 30 giây, thời gian thay đổi → mã thay đổi → mã cũ vô hiệu.

## Cách naive — tại sao nó không work

Cách đơn giản nhất ai cũng nghĩ đến: server tạo ra một mã ngẫu nhiên, lưu vào database kèm thời gian hết hạn, gửi cho mày qua SMS hoặc app, mày nhập lại, server tra DB kiểm tra.

Cách này thực ra là SMS OTP đang làm — và nó có vài vấn đề nghiêm trọng:

**Replay attack:** Nếu ai đó chặn được mã OTP của mày (SIM swap, SS7 attack, man-in-the-middle), họ có thể dùng nó trong khoảng thời gian còn hiệu lực. 10 phút đủ để làm nhiều thứ.

**DB lookup mỗi lần xác thực:** Server phải lưu trữ và tra cứu từng mã cho từng user mỗi lần verify. Với hàng triệu user đang đăng nhập, đây là database bottleneck lớn.

**Phụ thuộc vào kênh gửi:** SMS có thể bị delay, bị chặn, hoặc mày đang ở vùng không sóng. Cái app Authenticator của mày thì không cần mạng — và đó chính là hint cho cơ chế thật sự.

## Cái trick thật sự đằng sau

Google Authenticator không nhận mã từ server. Nó **tự tính mã** — và server cũng **tự tính mã đó** — rồi cả hai so sánh kết quả. Không cần giao tiếp gì thêm.

> **Hãy tưởng tượng:** Mày và bạn thân cùng có một cuốn sách giống hệt nhau. Mỗi ngày mày đọc trang bằng số ngày trong năm. Nếu hôm nay là ngày 183, cả hai đều mở đúng trang 183 mà không cần nhắn nhau. OTP hoạt động y như vậy — "trang sách" là thời gian, "cuốn sách" là secret key chung.

Đây là **TOTP — Time-based One-Time Password** (RFC 6238). Nguyên lý:

```
Secret Key (thiết lập một lần khi quét QR code)
         |
         +-----> [Điện thoại]  tính mã từ (secret + thời gian hiện tại) → 6 chữ số
         |
         +-----> [Server]      tính mã từ (secret + thời gian hiện tại) → 6 chữ số
                                                   ↑
                                    cứ 30 giây đổi một lần
```

Cả hai bên dùng cùng hai input: **secret key** và **thời gian**. Cùng input → cùng output. Không cần trao đổi mã qua mạng.

**Tại sao mã đổi mỗi 30 giây?** Thời gian được chia thành các "cửa sổ" 30 giây. Mỗi cửa sổ có một số thứ tự riêng:

```
Lúc 12:00:00 → đang ở cửa sổ #58320000
Lúc 12:00:29 → vẫn cửa sổ #58320000  (mã không đổi)
Lúc 12:00:30 → sang cửa sổ #58320001  (mã đổi ngay!)
```

Số thứ tự cửa sổ thay đổi → input thay đổi → mã 6 số thay đổi.

**HMAC-SHA1** là hàm tính mã một chiều: biết hai input thì tính được output, nhưng từ output không ngược ra được input. Nếu ai thấy mã "482931", họ không thể tìm ra secret key. Đây là tính chất bảo mật cốt lõi của TOTP.

## Nếu bạn muốn hiểu sâu hơn _(đọc thêm, không bắt buộc)_

**Cái QR code mày scan khi setup 2FA** không chứa mã OTP. Nó chứa **secret key**, được encode thành chuỗi ký tự:

```
otpauth://totp/Google%3Amay%40gmail.com?secret=JBSWY3DPEHPK3PXP&issuer=Google
```

`JBSWY3DPEHPK3PXP` là secret key. Authenticator đọc nó, lưu an toàn vào bộ nhớ bảo mật của điện thoại. Từ đó về sau, mọi mã OTP đều được tính offline hoàn toàn — không cần mạng, không cần liên lạc với server.

**Vấn đề đồng hồ lệch:** Điện thoại và server không hoàn toàn khớp giờ nhau. Nếu điện thoại chậm 15 giây, mã tính ra có thể thuộc cửa sổ cũ. Giải pháp: server chấp nhận mã của cửa sổ hiện tại **và** cửa sổ liền trước, liền sau. Thực tế mày có khoảng 90 giây thay vì 30 giây để nhập.

**Tại sao dùng được một lần?** Server ghi nhớ cửa sổ thời gian cuối cùng đã xác thực thành công. Submit lần hai với cùng mã trong cùng cửa sổ → bị từ chối ngay. Sang cửa sổ kế tiếp mới được chấp nhận.

**SMS OTP khác hoàn toàn:** Server tạo mã ngẫu nhiên, lưu vào database, gửi qua nhà mạng. Không có secret key chung, không có tính toán offline. Yếu hơn TOTP vì có thể bị chặn qua SIM swap hoặc tấn công vào hạ tầng mạng di động.

## Mày thấy nó ở đâu trong thực tế

**Google Authenticator, Authy, Microsoft Authenticator** đều implement TOTP. Authy có thêm cloud backup encrypted secret — tiện hơn nhưng trust model phức tạp hơn vì secret không còn chỉ tồn tại trên device của mày.

**GitHub, AWS, Cloudflare** đều support TOTP 2FA. Khi mày mất điện thoại, backup codes họ cấp lúc setup thực ra là pre-generated one-time tokens — không phải TOTP, chỉ là random tokens lưu server để dùng emergency.

**YubiKey và hardware security keys** đi xa hơn TOTP: dùng FIDO2/WebAuthn với public-key cryptography, private key không bao giờ rời khỏi thiết bị vật lý, chống phishing hoàn toàn vì credential bị bind với domain. Nhưng TOTP vẫn là tiêu chuẩn phổ biến nhất cho consumer apps vì setup đơn giản hơn nhiều.

## Một dòng để nhớ

OTP hết hạn không phải vì server thu hồi nó — mà vì thời gian là một phần của công thức, và thời gian không đi ngược.

---
*Bài tiếp theo: Tại sao HTTPS không bị nghe lén dù đi qua hàng chục server?*
