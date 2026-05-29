---
title: "Nginx thực tế: config từ dev đến production"
description: "Reverse proxy, HTTPS, gzip, rate limit ở tầng infra — những thứ Nginx phải làm trước khi request chạm Spring Boot."
category: programming
pubDate: 2026-06-14
series: "Phần 12: Production & Ops"
tags: ["nginx", "reverse-proxy", "https", "production", "devops"]
---

Mày deploy Spring Boot lên server. Chạy `java -jar app.jar`, thấy `Started AppointmentApplication in 4.3 seconds`, hài lòng. Rồi gõ IP:8080 trên browser — vào được. Xong.

Vài tuần sau, PM hỏi: "Tại sao không có HTTPS? Tại sao đôi lúc bị spam hàng nghìn request? Tại sao static file tải chậm vậy?" Mày nhìn lại `java -jar` và nhận ra: port 8080, HTTP, không có gì đứng trước nó cả.

Đó là lúc Nginx xuất hiện.

---

## Nginx làm gì mà Spring Boot không làm

Spring Boot xử lý business logic. Nó không được tối ưu để làm những việc kiểu infra như terminate TLS, nén response, hay chặn IP spam. Nginx đứng phía trước, nhận request từ client, rồi chuyển vào Spring Boot — chỉ phần request đã qua lọc và sạch hơn.

Kiến trúc cơ bản:

```
Client → [Nginx :443] → [Spring Boot :8080]
```

Client không bao giờ biết Spring Boot đang chạy ở port 8080. Với ngoài thế giới, chỉ tồn tại Nginx ở port 443 (HTTPS) hoặc 80 (HTTP).

---

## Config cơ bản: reverse proxy

Bắt đầu từ thứ đơn giản nhất — Nginx nhận request và forward vào Spring Boot:

```nginx
# /etc/nginx/sites-available/hms.conf

server {
    listen 80;
    server_name hms.example.com;

    location / {
        proxy_pass http://localhost:8080;

        # Nói cho Spring Boot biết request thật đến từ đâu
        proxy_set_header Host              $host;
        proxy_set_header X-Real-IP         $remote_addr;
        proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

Ba header `X-Real-IP`, `X-Forwarded-For`, `X-Forwarded-Proto` là bắt buộc. Nếu thiếu, Spring Boot nhìn vào `request.getRemoteAddr()` sẽ thấy `127.0.0.1` — tức là chính Nginx, không phải IP của client thật. Log sẽ vô nghĩa, rate limit sẽ block nhầm.

Trong Spring Boot, để đọc được IP thật qua Nginx, cần bật `ForwardedHeaderFilter` hoặc cấu hình `server.forward-headers-strategy=framework` trong `application.properties`. Không bật thì header có gửi cũng không được đọc đúng.

---

## HTTPS với Let's Encrypt

HTTP trên production năm 2026 là không chấp nhận được — browser sẽ cảnh báo, một số API sẽ từ chối call. Let's Encrypt cấp certificate miễn phí, `certbot` tự động hóa phần lớn:

```bash
# Cài certbot (Ubuntu)
apt install certbot python3-certbot-nginx

# Lấy certificate và tự động sửa nginx config
certbot --nginx -d hms.example.com
```

Sau khi chạy xong, certbot tự thêm vào config của mày:

```nginx
server {
    listen 443 ssl;
    server_name hms.example.com;

    ssl_certificate     /etc/letsencrypt/live/hms.example.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/hms.example.com/privkey.pem;

    # Certbot thêm các ssl_* params từ /etc/letsencrypt/options-ssl-nginx.conf
    include /etc/letsencrypt/options-ssl-nginx.conf;

    location / {
        proxy_pass http://localhost:8080;
        proxy_set_header Host              $host;
        proxy_set_header X-Real-IP         $remote_addr;
        proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}

# Redirect HTTP → HTTPS
server {
    listen 80;
    server_name hms.example.com;
    return 301 https://$host$request_uri;
}
```

Certificate Let's Encrypt hết hạn sau 90 ngày. Certbot tự setup cronjob renew — kiểm tra bằng `systemctl list-timers | grep certbot`.

---

## Gzip: đừng gửi JSON nặng khi có thể nhẹ hơn

Response JSON từ HMS — danh sách appointment, medical record — có thể lên vài chục KB. Gzip nén chúng xuống còn 15–20% kích thước ban đầu (tùy content), không cần thay đổi gì ở Spring Boot:

```nginx
http {
    gzip on;
    gzip_types
        text/plain
        text/css
        application/json
        application/javascript
        text/xml
        application/xml;

    # Chỉ compress response lớn hơn 1KB — nhỏ hơn compress còn tốn CPU hơn lợi
    gzip_min_length 1024;

    # Compression level 1–9, 6 là điểm cân bằng CPU vs ratio
    gzip_comp_level 6;
}
```

Đặt trong block `http {}` của `/etc/nginx/nginx.conf`, không phải trong `server {}` riêng lẻ.

---

## Rate limiting: chặn spam ở tầng infra

HMS có endpoint `POST /appointments` và `POST /auth/login`. Không có gì ngăn một script gọi 1000 request/giây nếu Spring Boot không tự chặn. Rate limit ở Nginx rẻ hơn để request xuống tới Java:

```nginx
http {
    # Khai báo zone: theo IP, giới hạn 10 request/giây
    # 10m = bộ nhớ cho ~160,000 IP
    limit_req_zone $binary_remote_addr zone=api_limit:10m rate=10r/s;

    # Zone riêng cho login — bảo vệ brute force
    limit_req_zone $binary_remote_addr zone=login_limit:10m rate=5r/m;
}

server {
    # ...

    location /api/ {
        limit_req zone=api_limit burst=20 nodelay;
        # burst=20: cho phép vượt ngắn hạn tối đa 20 req
        # nodelay: không cho vào queue, trả 503 ngay nếu vượt burst

        proxy_pass http://localhost:8080;
        # ... headers
    }

    location /api/auth/login {
        limit_req zone=login_limit burst=3 nodelay;
        proxy_pass http://localhost:8080;
        # ... headers
    }
}
```

Khi vượt giới hạn, Nginx trả `503 Service Unavailable` — client biết bị throttle, Spring Boot không tốn thread để xử lý request đó.

---

## Upstream pool: nhiều instance Spring Boot

HMS scale lên 2–3 instance Spring Boot (bài 70 — Load Balancer), Nginx đóng vai load balancer nội bộ:

```nginx
http {
    upstream hms_backend {
        # Round-robin mặc định
        # max_fails: số lần fail trước khi đánh dấu unhealthy
        # fail_timeout: giữ trạng thái unhealthy trong 30s trước khi thử lại
        server localhost:8080 max_fails=3 fail_timeout=30s;
        server localhost:8081 max_fails=3 fail_timeout=30s;
        server localhost:8082 max_fails=3 fail_timeout=30s;
    }
}

server {
    # ...
    location / {
        proxy_pass http://hms_backend;
        # ... headers

        # Nếu instance trả 5xx hoặc timeout, thử instance khác
        proxy_next_upstream error timeout http_500 http_502 http_503;
    }
}
```

Cấu hình này giúp deploy rolling update mà không downtime: tắt một instance, deploy, bật lại, rồi sang instance tiếp theo — trong khi Nginx vẫn route traffic vào những instance còn sống.

---

## Static file: đừng để Spring Boot phục vụ file tĩnh

Nếu HMS có frontend React build ra `/dist` và deploy cùng server, để Nginx serve thẳng, không đẩy qua Java:

```nginx
server {
    # ...

    # Static files: Nginx serve trực tiếp, không đi Spring Boot
    location /static/ {
        root /var/www/hms;
        expires 1y;
        add_header Cache-Control "public, immutable";
    }

    # API: đi Spring Boot
    location /api/ {
        proxy_pass http://localhost:8080;
        # ... headers
    }

    # Frontend SPA: fallback về index.html
    location / {
        root /var/www/hms;
        try_files $uri $uri/ /index.html;
    }
}
```

`try_files` quan trọng với SPA: nếu user vào thẳng `/appointments/123`, Nginx không tìm thấy file đó trên disk nên fallback về `index.html`, để React Router xử lý tiếp.

---

## Reload config không restart

Sau khi sửa config:

```bash
# Kiểm tra syntax trước
nginx -t

# Reload graceful — không drop request đang xử lý
nginx -s reload
```

Khác với `systemctl restart nginx` — restart sẽ kill process, drop connection đang mở. `reload` gửi SIGHUP để Nginx load config mới mà không ngắt connection hiện tại.

---

## Takeaway

Nginx không thay thế Spring Boot — nó làm những việc Spring Boot không nên làm: TLS termination, gzip, rate limit, static serving. Nếu mày đang expose Java trực tiếp ra internet ở port 8080 không có gì đứng trước, đó là production chờ sự cố.

---

*Bài tiếp theo: Circuit Breaker — vì sao một service chậm có thể kéo sập cả hệ thống*
