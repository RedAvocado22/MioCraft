---
title: "Tại sao đăng nhập Google một lần dùng được khắp nơi — SSO hoạt động thế nào?"
description: "Gmail, YouTube, Notion, Slack đều dùng tài khoản Google nhưng không app nào biết password của mày. Đây là cách OAuth 2.0, authorization code flow, và session cookie phối hợp để làm điều đó."
category: system-design
pubDate: 2026-07-07
series: "Behind the Tech: Auth & Security"
tags: ["sso", "oauth2", "oidc", "authentication", "jwt", "security"]
---

Mày đăng nhập Gmail buổi sáng. Chiều mở YouTube — không cần đăng nhập lại. Tối mở Notion, bấm "Continue with Google" — trang Google hiện ra, mày bấm một nút xác nhận, xong, mày đã vào Notion mà không cần gõ password.

Khoan. Notion làm sao biết mày là mày? Nó không có password của mày. Mày chưa từng tạo account Notion bằng email. Và cái trang Google hiện ra — cái đó là Google hay Notion giả mạo? Cả chuỗi này diễn ra trong chưa đến 2 giây, nhưng có rất nhiều thứ xảy ra phía sau.

## Cách naive — tại sao nó không work

Cách đơn giản nhất để "đăng nhập bằng Google": mày nhập email và password Google vào form của Notion, Notion gửi lên Google để verify, Google xác nhận đúng sai.

Đây là cách tệ nhất có thể nghĩ ra. Notion có password Google của mày. Slack cũng có. Figma cũng có. Mỗi app đó là một điểm có thể bị hack, và nếu họ bị breach thì password của mày lọt ra. Chưa kể mày không thể revoke quyền truy cập của từng app riêng lẻ — đổi password Google là revoke tất cả, không đổi là tất cả đều có quyền mãi mãi.

Đây là lý do cách này không tồn tại trong thực tế. Không một IdP (Identity Provider) nghiêm túc nào cho phép third-party nhận password của user.

Vậy thì cách thật sự là gì?

## Cái trick thật sự đằng sau

Cơ chế thật là **OAuth 2.0 + OpenID Connect (OIDC)**. Ý tưởng cốt lõi: Google xác thực mày, rồi cấp cho Notion một *token* chứng minh mày đã xác thực — không cần Notion biết password.

Toàn bộ flow trông như thế này:

```
Mày (Browser)              Notion (App)              Google (IdP)
     |                          |                          |
     |-- click "Login Google" ->|                          |
     |                          |-- tạo auth URL --------> |
     |<-------- redirect đến accounts.google.com ----------|
     |                          |                          |
     |---------- nhập password, 2FA (nếu chưa login) ---->|
     |                          |                          |
     |<-- redirect về notion.so/callback?code=ABC123 ------|
     |                          |                          |
     |-- GET /callback?code=ABC123 --->|                   |
     |                          |-- POST /token ---------->|
     |                          |   (code + client_secret) |
     |                          |<-- access_token + id_token|
     |                          |                          |
     |<-- đăng nhập thành công--|                          |
```

Từng bước một:

**Bước 1 — Notion tạo authorization URL.** Khi mày bấm "Continue with Google", Notion redirect browser của mày đến:

```
https://accounts.google.com/o/oauth2/v2/auth?
  client_id=notion-app-123
  &redirect_uri=https://notion.so/callback
  &response_type=code
  &scope=openid email profile
  &state=xyz789
```

Tham số quan trọng: `client_id` là ID của Notion (đăng ký trước với Google), `scope=openid` kích hoạt OIDC, `state` là random string để chống CSRF.

**Bước 2 — Mày xác thực với Google.** Mày đang ở `accounts.google.com` — đây là trang *thật* của Google, không phải Notion. Nếu mày đã đăng nhập Gmail thì bước này là silent (Google đã có session cookie). Mày chỉ thấy màn hình "Notion wants access to: your email, your name" và bấm Allow.

**Bước 3 — Google trả về `authorization_code`.** Google redirect browser về `notion.so/callback?code=ABC123&state=xyz789`. Đây là code một lần dùng, hết hạn trong ~10 phút.

**Bước 4 — Notion đổi code lấy token (server-to-server).** Đây là bước quan trọng nhất. Notion server gọi thẳng đến Google backend:

```
POST https://oauth2.googleapis.com/token
  code=ABC123
  client_id=notion-app-123
  client_secret=<secret-chỉ-notion-biết>
  redirect_uri=https://notion.so/callback
```

Google trả về `access_token` và `id_token`. Bước này xảy ra server-to-server, browser không thấy gì.

**Bước 5 — Notion đọc `id_token`.** `id_token` là một **JWT** (JSON Web Token) — chuỗi base64 được ký bằng private key của Google. Notion verify chữ ký bằng Google's public key, rồi đọc payload:

```json
{
  "sub": "116309867943",
  "email": "mày@gmail.com",
  "name": "Tên Của Mày",
  "iat": 1720000000,
  "exp": 1720003600
}
```

`sub` là stable user ID của mày trong hệ thống Google — không đổi dù mày đổi email hay tên. Notion dùng `sub` để lookup hoặc tạo account trong database của họ. Xong. Notion không biết password, không cần biết.

## Đi sâu hơn — chi tiết kỹ thuật

**Phần SSO thật sự ở đâu?** Khi mày đăng nhập Gmail, Google set một session cookie trên domain `accounts.google.com`. Cookie này persist trong browser. Khi Notion redirect mày đến `accounts.google.com` để authorize, Google thấy cookie đó — mày đã authenticated rồi — nên skip màn hình nhập password. Flow OAuth vẫn chạy đầy đủ, nhưng bước xác thực là silent. Mày chỉ thấy màn hình "Allow access" chứ không thấy "Enter password".

Đây là lý do SSO hoạt động: không phải Google "nói chuyện ngầm" với Notion — mà là Google nhớ session của mày và bỏ qua bước authentication.

**Tại sao dùng `authorization_code` thay vì trả token thẳng?** Vì redirect URL đi qua browser. Nếu Google trả `access_token` trong URL redirect, nó nằm trong browser history, server logs, referrer headers — rủi ro lộ. `authorization_code` chỉ dùng được một lần, trong thời gian ngắn, và việc đổi code lấy token xảy ra server-to-server với `client_secret` — không bao giờ qua browser.

**`access_token` vs `id_token`:** `id_token` chứa *identity* (ai mày là), `access_token` cho phép gọi Google APIs thay mặt mày (đọc Drive, Calendar...). Với "Login with Google" thuần túy, Notion chỉ cần `id_token`. `access_token` chỉ cần khi app muốn thao tác với Google services.

**PKCE (Proof Key for Code Exchange):** Trên mobile apps hay SPA không có `client_secret`, có một extension gọi là PKCE. App tạo random `code_verifier`, hash nó thành `code_challenge`, gửi `code_challenge` lên lúc authorize. Lúc đổi code lấy token, gửi `code_verifier` gốc. Google verify hash match. Ngăn attack code interception dù không có secret.

**Revocation:** Vì Notion không có password của mày, mày có thể revoke quyền của Notion bất cứ lúc nào từ `myaccount.google.com/permissions` mà không ảnh hưởng đến Gmail hay YouTube. Đây là advantage lớn so với password sharing.

## Mày thấy nó ở đâu trong thực tế

**GitHub** dùng OAuth 2.0 tương tự cho "Login with GitHub" — nhưng còn expose thêm OAuth apps API để user quản lý permissions của từng app, xem app nào có quyền gì với repository nào. Granular hơn nhiều so với Google's "đọc email và profile".

**Slack** là cả IdP lẫn Relying Party. Slack dùng "Login with Google" cho user của mình (RP), nhưng cũng cung cấp "Login with Slack" cho third-party apps (IdP). Một công ty enterprise thường setup SAML (giao thức SSO cấp enterprise, tương tự OIDC nhưng dùng XML thay JWT) để integrate Slack với corporate identity system như Okta hay Azure AD.

**Apple Sign In** buộc tất cả iOS apps có "Login with Google/Facebook" phải cung cấp "Sign in with Apple" song song — App Store policy. Apple's implementation có một twist privacy: Apple cho phép mày dùng *relay email* (`random@privaterelay.appleid.com`) thay vì email thật, nên app không biết email thật của mày. App chỉ nhận `sub` và relay address.

## Một dòng để nhớ

SSO không phải Google nói chuyện với Notion — mà là Google nhớ mày, cấp token làm bằng chứng, và Notion tin token đó vì nó có chữ ký của Google.

---
*Bài tiếp theo: Tại sao OTP chỉ dùng được một lần và hết hạn sau 30 giây?*
