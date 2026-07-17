---
title: "Rate Limiting — hàng rào bảo vệ API khỏi spam và DDoS"
description: "Rate limiting kiểm soát số lượng request trong một khoảng thời gian. Token bucket, sliding window, fixed window — mỗi thuật toán có trade-off khác nhau về accuracy và memory."
category: system-design
pubDate: 2024-03-13
series: "Phần 8: System Design"
tags: ["system-design", "rate-limiting", "security"]
---

Giả sử HMS của bạn có endpoint `/api/appointments/book`. Một buổi sáng, bạn nhận được cảnh báo: CPU đang ở 100%, database pool đã cạn, hệ thống không response được nữa.

Bạn check log. Một IP address đang gửi 500 request mỗi giây vào endpoint đó. Không phải hacker tinh vi — chỉ là ai đó viết script test load, hoặc một cái bug trong frontend gây ra retry loop. Nhưng kết quả thì như nhau: hệ thống của bạn đang chết.

Rate limiting là cái ngăn điều đó xảy ra.

---

## Rate limiting là gì

Rate limiting là cơ chế giới hạn số lượng request mà một client có thể gửi trong một khoảng thời gian nhất định. Ví dụ: mỗi user chỉ được đặt lịch tối đa 10 lần mỗi phút. Nếu vượt quá, server trả về `429 Too Many Requests` thay vì xử lý tiếp.

Đây không chỉ là bảo vệ chống DDoS — dù đó là một use case quan trọng. Rate limiting còn bảo vệ hệ thống khỏi:

- **Accidental abuse:** Frontend bug gây retry loop, script test load quá mạnh
- **Fair usage:** Đảm bảo một user không chiếm hết resource, ảnh hưởng đến user khác
- **Cost control:** Nếu bạn dùng external API có charge theo request, rate limiting giúp bạn không bị bill shock

---

## Các thuật toán rate limiting

**Fixed Window Counter** là đơn giản nhất: đếm số request trong một window cố định (ví dụ: mỗi phút). Nếu counter vượt threshold, reject. Vấn đề: boundary condition. Nếu limit là 100 request/phút, user gửi 100 request lúc 12:00:59 và 100 request nữa lúc 12:01:01 — về mặt kỹ thuật không vi phạm rule, nhưng thực tế 200 request trong 2 giây.

**Sliding Window** giải quyết vấn đề đó bằng cách xét window linh hoạt — thay vì đếm "trong phút này", đếm "trong 60 giây gần nhất tính từ thời điểm hiện tại." Chính xác hơn nhưng tốn memory hơn để track timestamps của mỗi request.

**Token Bucket** là thuật toán hay được dùng nhất trong thực tế. Mỗi user có một "bucket" chứa token. Mỗi request tiêu tốn một token. Token được thêm vào bucket ở tốc độ cố định (ví dụ: 10 token mỗi giây). Nếu bucket trống, request bị reject. Nếu không dùng, token tích lũy đến mức tối đa của bucket.

Điều hay của Token Bucket: nó cho phép burst traffic có kiểm soát. Nếu user không gửi request trong 10 giây, bucket của họ đầy, họ có thể gửi 10 request cùng lúc mà không bị reject. Behavior này phù hợp với cách user thực sự dùng hệ thống — không ai gửi đều đặn một request mỗi giây.

---

## Rate limiting trong Spring Boot với Redis

Rate limiting cần state — bạn phải nhớ user này đã gửi bao nhiêu request rồi. State đó cần được share giữa tất cả instance của service (vì có load balancer). Redis là lựa chọn tự nhiên.

Resilience4j có sẵn rate limiter, nhưng nó in-memory (không share giữa instances). Với production setup, cần implement trên Redis:

```java
@Component
public class RedisRateLimiter {
    
    private static final String RATE_LIMIT_KEY = "rate_limit:%s:%s"; // userId:endpoint
    
    @Autowired
    private RedisTemplate<String, String> redisTemplate;
    
    // Token bucket implementation với Lua script để atomic
    private static final String RATE_LIMIT_SCRIPT = """
        local key = KEYS[1]
        local capacity = tonumber(ARGV[1])
        local refill_rate = tonumber(ARGV[2])  -- token mỗi giây
        local now = tonumber(ARGV[3])
        local requested = tonumber(ARGV[4])
        
        local bucket = redis.call('HMGET', key, 'tokens', 'last_refill')
        local tokens = tonumber(bucket[1]) or capacity
        local last_refill = tonumber(bucket[2]) or now
        
        -- Tính số token cần thêm vào kể từ lần cuối
        local elapsed = now - last_refill
        tokens = math.min(capacity, tokens + elapsed * refill_rate)
        
        local allowed = 0
        if tokens >= requested then
            tokens = tokens - requested
            allowed = 1
        end
        
        redis.call('HMSET', key, 'tokens', tokens, 'last_refill', now)
        redis.call('EXPIRE', key, 3600)
        
        return allowed
        """;
    
    public boolean isAllowed(UUID userId, String endpoint) {
        String key = String.format(RATE_LIMIT_KEY, userId, endpoint);
        long now = System.currentTimeMillis() / 1000;
        
        // capacity: 20 token, refill: 5 token/giây
        Long result = redisTemplate.execute(
            new DefaultRedisScript<>(RATE_LIMIT_SCRIPT, Long.class),
            List.of(key),
            "20", "5", String.valueOf(now), "1"
        );
        
        return result != null && result == 1;
    }
}

// Filter áp dụng rate limiting cho booking endpoint
@Component
public class RateLimitFilter extends OncePerRequestFilter {
    
    @Autowired
    private RedisRateLimiter rateLimiter;
    
    @Override
    protected void doFilterInternal(HttpServletRequest request, 
                                     HttpServletResponse response,
                                     FilterChain chain) throws IOException, ServletException {
        
        if (request.getRequestURI().startsWith("/api/appointments/book")) {
            UUID userId = extractUserId(request); // từ JWT
            
            if (!rateLimiter.isAllowed(userId, "book_appointment")) {
                response.setStatus(429);
                response.setHeader("Retry-After", "60");
                response.getWriter().write("{\"error\":\"Too many requests\"}");
                return;
            }
        }
        
        chain.doFilter(request, response);
    }
}
```

Lý do dùng Lua script: tất cả operations (read tokens, calculate, write back) phải atomic. Nếu không, race condition có thể xảy ra khi nhiều request đến cùng lúc từ cùng một user.

---

## Rate limit ở đâu trong hệ thống

Trong production, rate limiting thường được implement ở nhiều tầng:

**API Gateway level:** Áp dụng cho tất cả traffic trước khi chạm đến service. Chặn DDoS sớm, không tốn resource của backend.

**Service level:** Rate limit tinh hơn theo business logic — user premium có limit cao hơn user free, các endpoint khác nhau có limit khác nhau.

**Database level:** Connection pool là một dạng rate limiting cho database — giới hạn số concurrent connection.

Với HMS, một setup đơn giản là đủ: rate limiting ở service level, khác nhau giữa `book_appointment` (limit thấp — nghiệp vụ nặng, dễ bị abuse) và `get_schedule` (limit cao hơn — read-only, nhẹ hơn).

---

## HTTP Headers cho rate limiting

Khi implement rate limiting, nên trả về headers để client biết họ đang ở đâu so với limit. Đây là convention được nhiều API lớn dùng:

```
X-RateLimit-Limit: 20          # tổng số request được phép trong window
X-RateLimit-Remaining: 15      # số request còn lại
X-RateLimit-Reset: 1704067200  # unix timestamp khi window reset
Retry-After: 60                # (khi 429) bao nhiêu giây nữa thì thử lại
```

Frontend biết được những thông tin này và có thể disable nút "Đặt lịch" khi remaining = 0, thay vì để user bấm và nhận lỗi.

---

## Takeaway

Mọi endpoint public đều cần rate limiting — không phải nếu, mà là bao nhiêu. Câu hỏi không phải "có nên implement không?" mà là "limit hợp lý cho endpoint này là gì?" — và câu trả lời đó đến từ hiểu business: bao nhiêu lần một user thực sự cần gọi endpoint này trong một phút?

---

*Bài tiếp theo: Circuit Breaker — vì sao một service chết mà cả hệ thống không sập theo*
