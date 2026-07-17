---
title: "Header tin cậy đến đâu trong microservices?"
description: "Gateway inject X-User-Id tiện nhưng chỉ an toàn khi downstream xác minh request thật sự đến từ trusted boundary. Internal flag không phải authentication."
category: system-design
pubDate: 2026-07-17
series: "Phần 8: System Design"
tags: ["security", "api-gateway", "microservices", "authentication", "case-study"]
---

API Gateway validate JWT rồi inject `X-User-Id` và `X-User-Role` cho downstream service. Controller phía sau không cần parse token lần nữa — đơn giản và giảm duplicate security logic.

Nhưng nếu client có thể gọi thẳng service port và tự gửi các header đó, nó chỉ cần viết:

```http
X-User-Id: admin-id
X-User-Role: ADMIN
```

Authorization lúc này dựa trên dữ liệu do attacker tự khai.

## Header chỉ đáng tin khi đường đi đáng tin

Flow mong muốn:

```text
Internet
  → Nginx
  → API Gateway: validate JWT
  → inject user context + gateway secret
  → downstream service
```

Downstream không nên tin `X-User-Id` chỉ vì header tồn tại. Nó phải xác minh request đến từ Gateway bằng một cơ chế riêng, đồng thời service port không được public ra host hoặc internet.

Một shared secret là giải pháp MVP có thể chấp nhận trong private network:

```text
X-Gateway-Secret: <random secret>
```

Production lớn hơn thường chuyển sang mTLS hoặc service mesh identity.

## Gateway-to-service và service-to-service là hai trust boundary

Cần phân biệt:

```text
Gateway → downstream service
Service A → Service B qua internal client
```

Gateway đại diện cho user context sau khi validate JWT. Internal service call đại diện cho workload identity của service gọi.

Dùng cùng một header hoặc giả làm Gateway cho cả hai đường khiến audit không biết request thực sự đến từ ai. Có thể tách:

- `X-Gateway-Secret` cho Gateway → service;
- `X-Internal-Secret` cho service → service;
- hoặc tốt hơn, certificate/service identity riêng cho từng workload.

## Một boolean flag không phải authentication

Endpoint internal đôi khi kiểm tra:

```java
if (!"true".equals(request.getHeader("X-Internal-Call"))) {
    throw new UnauthorizedException();
}
```

Bất kỳ client nào gửi được request cũng gửi được chuỗi `true`. Header này chỉ là marker, không chứng minh danh tính.

Internal endpoint cần secret đủ entropy, network policy, mTLS hoặc cơ chế authentication tương đương. Tên header có chữ “internal” không biến nó thành an toàn.

## Bốn lớp phải cùng đúng

Header trust chỉ an toàn khi đồng thời có:

1. **Gateway validate JWT thật** — signature, expiry và claims.
2. **Gateway xóa header giả từ client** trước khi inject giá trị chuẩn.
3. **Downstream xác minh nguồn gọi** bằng secret hoặc workload identity.
4. **Service port không public**, tránh bypass Gateway.

Thiếu một lớp có thể phá toàn bộ mô hình. Shared secret mạnh nhưng service vẫn expose port ra internet thì attacker có thêm bề mặt thử. Port private nhưng secret fallback là `changeme` cũng tạo cấu hình giả an toàn.

## So sánh secret cũng cần đúng

So sánh chuỗi bằng `.equals()` có thời gian chạy phụ thuộc vị trí ký tự khác nhau. Với secret giá trị cao, dùng constant-time comparison:

```java
boolean matches(String provided, String expected) {
    if (provided == null || expected == null) return false;

    return MessageDigest.isEqual(
        provided.getBytes(StandardCharsets.UTF_8),
        expected.getBytes(StandardCharsets.UTF_8)
    );
}
```

Đây không cứu được secret yếu hay endpoint public, nhưng tránh thêm một side channel không cần thiết.

## Khi nào nên để downstream tự validate JWT?

Mỗi service tự làm resource server có ưu điểm defense in depth và ít tin Gateway hơn. Đổi lại:

- duplicate config;
- mọi service phụ thuộc JWKS/identity provider;
- cần truyền nguyên bearer token qua internal hop;
- policy dễ lệch giữa các service.

Không có lựa chọn đúng cho mọi hệ thống. Quan trọng là mô hình trust phải được viết rõ và code thật phải khớp với nó — không chỉ tồn tại trong architecture diagram.

## Takeaway

`X-User-Id` không đáng tin vì tên của nó. Nó đáng tin khi request chỉ có thể đến qua một Gateway đã xác thực, header giả đã bị xóa và downstream xác minh đúng nguồn gọi.

Trong microservices, network path là một phần của authentication. Đừng dùng `X-Internal-Call: true` như một chiếc thẻ ADMIN tự in.

---

*Bài liên quan: Spring Security filter chain — request đi qua những gì trước controller.*
