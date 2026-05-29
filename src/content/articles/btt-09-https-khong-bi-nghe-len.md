---
title: "Tại sao HTTPS không bị nghe lén dù đi qua hàng chục server?"
description: "Gói tin từ điện thoại mày đến server Netflix đi qua hàng chục router. Bất kỳ ai ngồi giữa đường đều có thể thấy nó. Vậy tại sao họ không đọc được?"
category: system-design
pubDate: 2026-07-10
series: "Behind the Tech: Auth & Security"
tags: ["https", "tls", "cryptography", "security", "certificate", "encryption"]
---

Mày đang dùng wifi nhà hàng xóm — không có password, mọi người dùng chung. Mày mở ngân hàng online, chuyển tiền, đăng nhập Facebook. Ổng ấy có cái laptop cài Wireshark, có thể thấy mọi packet đi qua router nhà ổng.

Mày có nên lo không? Mọi thứ đều là HTTPS — cái ổ khóa xanh trên browser. Nhưng tại sao nó an toàn? Nếu mày chưa bao giờ gặp server Facebook trước đây, làm sao hai bên đồng ý được cách mã hóa mà không bị nghe lén trong lúc đang thảo luận?

## Cách naive — tại sao nó không work

Tưởng tượng mày và server muốn nói chuyện bí mật. Cách dễ nhất: dùng chung một password để mã hóa. Nhưng password đó phải được trao đổi qua mạng trước — và mạng đang bị theo dõi. Kẻ nghe lén bắt được password → decrypt mọi thứ sau đó.

Đây là **the key exchange problem** — bài toán cốt lõi của mật mã học hiện đại. Làm sao hai bên trao đổi secret trên một kênh không an toàn mà kẻ thứ ba dù có nghe tất cả cũng không thể biết secret đó là gì?

Encrypt bằng secret rồi gửi? Secret vẫn phải đi qua mạng. Gặp nhau trực tiếp để trao đổi? Không thực tế với internet. Brute force? Kẻ nghe lén cũng brute force được.

## Cái trick thật sự đằng sau

TLS giải quyết key exchange problem bằng cách dùng **toán học bất đối xứng**: session key không bao giờ đi qua mạng — cả hai bên **độc lập tính ra cùng một secret** từ thông tin public.

TLS 1.3 handshake, phiên bản đơn giản hóa:

```
Client                                    Server
  |                                          |
  |--- ClientHello (cipher suites, nonce) -->|
  |                                          |
  |<-- Certificate + ServerHello + key share-|
  |                                          |
  |  [Client xác minh certificate với CA]   |
  |                                          |
  |  [Cả hai tính session key từ key share] |
  |      (không ai gửi session key!)         |
  |                                          |
  |<======= Encrypted traffic (AES) =======>|
```

Bước quan trọng nhất là **ECDHE (Elliptic Curve Diffie-Hellman Ephemeral)** — thuật toán key exchange:

Client tạo cặp key riêng: private key `a`, public key `A = a × G`
Server tạo cặp key riêng: private key `b`, public key `B = b × G`

Cả hai trao đổi public key (`A` và `B`) — kẻ nghe thấy cả hai.

Client tính: `S = a × B`
Server tính: `S = b × A`

Vì toán học elliptic curve: `a × (b × G) = b × (a × G)` — cả hai ra cùng `S`.

Kẻ nghe lén có `A`, `B`, nhưng không có `a` hay `b`. Việc tính ngược từ `A` ra `a` (bài toán discrete logarithm trên elliptic curve) tốn thời gian cỡ tuổi vũ trụ với key đủ lớn.

`S` này là cơ sở để derive **session key** — key đối xứng (AES-256-GCM) dùng để encrypt toàn bộ dữ liệu sau đó.

## Đi sâu hơn — chi tiết kỹ thuật

**Certificate là gì và tại sao quan trọng?** ECDHE giải quyết key exchange — nhưng chưa đủ. Mày biết mình đang nói chuyện với *ai đó*, nhưng người đó có thực sự là Facebook không?

Certificate là file chứa:
- Tên domain (`*.facebook.com`)
- Public key của server
- Chữ ký số của Certificate Authority (CA) — một tổ chức thứ ba được tin tưởng

Browser và OS của mày có sẵn danh sách ~150 CA được trust (Root Store). Khi server gửi certificate, browser verify chữ ký:

```
Certificate chain:
facebook.com cert
    → signed by DigiCert Inc (Intermediate CA)
        → signed by DigiCert Global Root CA (Root CA)
            → in browser's trusted root store ✓
```

Nếu certificate không có chữ ký hợp lệ từ trusted CA, browser bắn cảnh báo đỏ. Đây là lý do tấn công MITM rất khó: kẻ tấn công có thể ngồi giữa và relay traffic, nhưng không thể tạo ra certificate hợp lệ cho `facebook.com` vì không có private key của Facebook và không thể lừa CA ký certificate giả.

**HTTPS không giấu được tất cả.** TLS mã hóa *nội dung* request — URL, headers, body. Nhưng để connect đến server, client phải gửi **SNI (Server Name Indication)** — hostname — trong bước đầu của handshake, trước khi mã hóa. Wireshark vẫn thấy mày đang nói chuyện với `facebook.com`, chỉ là không thấy mày đang nhắn gì hay xem gì.

DNS query (`facebook.com` → IP address) cũng là plaintext mặc định. **DNS over HTTPS (DoH)** giải quyết phần này — Firefox và Chrome đều support.

**"E" trong ECDHE là Ephemeral** — có nghĩa gì? Mỗi session tạo một cặp key ECDHE mới. Nếu private key dài hạn của server bị lộ, kẻ tấn công không thể decrypt lại các session cũ vì session key đã bị xóa. Đây là **forward secrecy** — bảo vệ quá khứ kể cả khi hiện tại bị compromise.

**Tại sao dùng cả asymmetric lẫn symmetric?** Asymmetric crypto (ECDHE) chậm hơn symmetric (AES) nhiều lần. TLS dùng asymmetric chỉ để trao đổi session key một lần, rồi toàn bộ dữ liệu dùng AES nhanh hơn nhiều. Best of both worlds.

## Mày thấy nó ở đâu trong thực tế

**Ngân hàng online và payment gateways** dùng TLS 1.3 với certificate pinning — app biết trước chính xác certificate nào được chấp nhận, không accept bất kỳ certificate nào dù có CA valid. Chống lại trường hợp CA bị compromise hoặc bị ép ký certificate giả.

**VPN không bypass TLS** — VPN mã hóa thêm một lớp nữa bên ngoài, nhưng HTTPS traffic bên trong vẫn được TLS bảo vệ. VPN chỉ ẩn thêm SNI và IP của server mày đang nói chuyện với.

**Let's Encrypt** democratize HTTPS bằng cách cấp certificate miễn phí và tự động qua ACME protocol. Trước năm 2016, certificate tốn vài trăm đô/năm và cần verify thủ công — đó là lý do nhiều site nhỏ vẫn dùng HTTP. Giờ thì không còn lý do để không dùng HTTPS nữa.

## Một dòng để nhớ

Session key không bao giờ được gửi qua mạng — cả hai bên tự tính ra cùng một kết quả từ thông tin public, nhờ toán học mà kẻ đứng giữa không thể đảo ngược.

---
*Bài tiếp theo: Tại sao Zalo biết mày đã "đọc" tin nhắn?*
