---
title: "Load Balancer — bí mật giúp hệ thống chịu hàng chục nghìn request/giây"
description: "Load balancer phân phối traffic đến nhiều server — nhưng thuật toán, layer 4 vs layer 7, health check, và sticky session mới là thứ quyết định hệ thống có thật sự reliable không."
category: system-design
pubDate: 2024-03-11
series: "Phần 8: System Design"
tags: ["system-design", "load-balancer", "scalability"]
---

Khi bạn chạy Spring Boot trên máy local, có một server đang lắng nghe ở port 8080. Một request vào, server xử lý, trả response. Mọi thứ sequential và đơn giản.

Bây giờ tưởng tượng hệ thống đó phục vụ một bệnh viện lớn. 8 giờ sáng thứ Hai, bệnh nhân đổ xô vào đặt lịch — vài trăm request mỗi giây cùng lúc. Một server đơn không thể xử lý hết. Bạn cần nhiều server hơn.

Nhưng client biết gọi vào server nào? Làm sao phân phối traffic đều? Nếu một server chết thì sao? Đây là vấn đề mà load balancer giải quyết.

---

## Load Balancer là gì và nó đứng ở đâu

Load balancer là một component đứng giữa client và các server backend. Client chỉ biết một địa chỉ duy nhất — địa chỉ của load balancer. Load balancer nhận request vào, quyết định server nào sẽ xử lý, forward request đó đi, nhận response về, và trả lại cho client.

```
Client → Load Balancer → [Server 1]
                      → [Server 2]  
                      → [Server 3]
```

Client không biết có bao nhiêu server phía sau. Load balancer che giấu toàn bộ topology.

Hai lợi ích chính:

**Horizontal scaling:** Thay vì mua một server khủng để chịu được load cao (vertical scaling), bạn có thể chạy nhiều server vừa phải. Khi cần thêm capacity, thêm server mới và đăng ký với load balancer — không cần downtime.

**High availability:** Nếu một server chết, load balancer phát hiện ra (qua health check) và ngừng gửi traffic đến server đó. Client không biết chuyện gì xảy ra, hệ thống vẫn chạy.

---

## Các thuật toán phân phối traffic

**Round Robin** là cơ bản nhất: request 1 đến server 1, request 2 đến server 2, request 3 đến server 3, request 4 đến server 1 lại. Đơn giản, nhưng giả định tất cả request đều có cost tương đương — điều này thường không đúng. Request xem danh sách appointment rất nhẹ, request export PDF toàn bộ lịch sử bệnh nhân rất nặng.

**Least Connections** thông minh hơn: gửi request mới đến server đang có ít active connection nhất. Server nào đang bận xử lý heavy request thì nhận ít request mới hơn. Phù hợp hơn khi workload không đồng đều.

**IP Hash** đảm bảo request từ cùng một client IP luôn đến cùng một server — **sticky sessions**. Cần thiết khi server lưu state của user trong memory (session). Nhưng đây là dấu hiệu của một design problem — stateful server khó scale. Cách tốt hơn là externalize state ra Redis để tất cả server đều access được, rồi dùng Round Robin.

---

## Stateless là yêu cầu bắt buộc để scale

Đây là điểm quan trọng nhất của bài: **để chạy được nhiều instance, mỗi server phải stateless.**

Stateless có nghĩa là: một request có thể đến bất kỳ server nào và được xử lý hoàn toàn — không cần biết request trước đó đã đến server nào.

Trong Spring Boot, điều này ảnh hưởng đến cách bạn handle authentication. Nếu bạn lưu session trong memory của server (HTTP session truyền thống), thì request thứ hai của user phải đến đúng server đó mới còn session. Với nhiều server thì không đảm bảo được điều đó.

JWT giải quyết vấn đề này: token được client giữ, gửi kèm mỗi request, server verify token mà không cần lookup bất kỳ state nào. Bất kỳ server nào cũng xử lý được. Đây là một trong những lý do HMS của bạn dùng JWT thay vì session truyền thống.

```java
// ❌ Stateful — lưu user context trong session, không scale được
@PostMapping("/login")
public ResponseEntity<?> login(@RequestBody LoginRequest request, HttpSession session) {
    User user = authService.authenticate(request);
    session.setAttribute("currentUser", user); // chỉ server này biết
    return ResponseEntity.ok().build();
}

// ✅ Stateless — JWT, bất kỳ server nào cũng verify được
@PostMapping("/login")  
public ResponseEntity<LoginResponse> login(@RequestBody LoginRequest request) {
    String token = authService.authenticate(request); // trả JWT về client
    return ResponseEntity.ok(new LoginResponse(token));
}
```

---

## Health Check — cách load balancer biết server nào còn sống

Load balancer định kỳ gửi request đến một endpoint đặc biệt của mỗi server — thường là `/actuator/health` trong Spring Boot. Nếu server trả về 200, nó được coi là healthy. Nếu không response hoặc trả về lỗi, load balancer đánh dấu server đó là down và ngừng gửi traffic.

Spring Boot Actuator cung cấp health endpoint sẵn. Bạn có thể customize nó để check cả database connection, Redis connection — bất kỳ dependency nào mà nếu down thì server cũng không còn serve được:

```java
// application.properties
management.endpoints.web.exposure.include=health
management.endpoint.health.show-details=when-authorized

// Custom health check cho Redis
@Component
public class RedisHealthIndicator implements HealthIndicator {
    @Autowired
    private RedisTemplate<String, String> redisTemplate;
    
    @Override
    public Health health() {
        try {
            redisTemplate.opsForValue().get("health-check");
            return Health.up().build();
        } catch (Exception e) {
            return Health.down().withDetail("error", e.getMessage()).build();
        }
    }
}
```

Nếu Redis chết và slot booking của bạn phụ thuộc vào Redis, thì việc báo server là unhealthy và nhận ít traffic hơn là behavior đúng.

---

## Layer 4 vs Layer 7 — không phải mọi load balancer đều như nhau

**Layer 4 load balancer** hoạt động ở tầng transport — TCP/UDP. Nó chỉ nhìn thấy IP và port, không nhìn thấy nội dung HTTP. Nhanh và đơn giản, nhưng không thể routing dựa trên content.

**Layer 7 load balancer** hoạt động ở tầng application — HTTP. Nó đọc được URL, header, cookie. Điều này cho phép content-based routing: request đến `/api/reports` đi đến cluster report-heavy servers, request đến `/api/appointments` đi đến cluster khác. Nginx và AWS Application Load Balancer là Layer 7.

Trong thực tế, Layer 7 là lựa chọn phổ biến cho web application vì nó flexible hơn nhiều.

---

## Takeaway

Thiết kế Spring Boot service của bạn luôn với assumption rằng nó sẽ chạy nhiều instance. Kiểm tra một điều: *"Nếu mình chạy ba instance của service này cùng lúc, có gì break không?"* — bất kỳ thứ gì lưu state trong memory của server (local cache không share, in-memory session) đều là candidate cho vấn đề.

---

*Bài tiếp theo: Message Queue — khi nào cần, khi nào không*
