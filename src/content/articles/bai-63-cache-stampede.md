---
title: "Cache Stampede — khi cache sập gây sập cả hệ thống"
description: "Cache expire, hàng nghìn request cùng lúc hit database, database quá tải và sập — kéo theo cache không thể warm up lại. Thundering herd problem và cách phòng tránh."
category: system-design
pubDate: 2024-03-04
series: "Phần 7: Backend & Hệ thống"
tags: ["caching", "performance", "distributed-systems"]
---

Có một loại bug hiếm gặp nhưng rất nguy hiểm ở production: cache stampede (hay thundering herd).

Tưởng tượng HMS của cậu chạy tốt mấy tuần liền. Bất ngờ một hôm, lúc 2 giờ sáng, HMS bị down hoàn toàn. Alarm rải rác. Devops chạy vào check — database CPU 99%, memory cache full, application threads tất cả chặn. Nhưng không có data corruption, không có bug code mới, không có traffic spike. Tại sao?

Đó chính là **cache stampede**.

---

## Tình huống: Cache stampede là gì

Giả sử HMS cache doctor list với TTL = 1 hour:

```
14:00 - Doctor list được cache
14:00 - Cache put: key="doctors", value=List[100 doctors], ttl=3600s
15:00 - Cache expired (TTL hết)
15:00:00.001 - User A request doctor list
15:00:00.002 - Cache miss → Query database → Start query (50ms)
15:00:00.003 - User B request doctor list
15:00:00.004 - Cache miss → Query database → Start query (50ms)
15:00:00.005 - User C request doctor list
15:00:00.006 - Cache miss → Query database → Start query (50ms)
...
15:00:00.100 - User Z request doctor list
15:00:00.101 - Cache miss → Query database → Start query (50ms)
```

Nếu cùng lúc 100 requests hit cache miss (vì cache expire cùng lúc), tất cả gọi database cùng lúc. Database bị **thundering herd** — 100 queries cùng chạy song song.

Lúc đó, database CPU spike lên 100%. Các queries khác (appointment booking, payment) bị delay. Vì thread pool của Spring Boot chặn chờ database, requests mới bắt đầu queue up.

Nếu database không crash, cậu sẽ thấy:
- Response time từ bình thường 100ms → jump lên 5s
- User timeout
- Cascading failures (client retry, thêm requests, thêm load)

---

## Tại sao cache stampede xảy ra

Ở low scale, cache stampede không xảy ra vì:
- Ít users, requests không hit cùng lúc
- Database nhỏ, query nhanh
- Cache key short-lived

Nhưng khi HMS scale lên (10,000+ users, complex queries):
- Requests **cùng lúc** hit cache miss
- Query tốn 200-500ms (complex joins)
- Database bị overwhelmed

Cái kinh khủng: **cache stampede thường xảy ra ở exact timing nào đó trong ngày** (ví dụ: exact hour mark khi cache expire), khiến nó rất khó reproduce locally.

---

## Giải pháp 1: Probabilistic early expiration

Thay vì cache expire cùng lúc cho tất cả requests, thêm randomness:

```java
@Cacheable(value = "doctors", cacheManager = "redisCache")
public List<Doctor> getAllDoctors() {
    return doctorRepository.findAll();
}
```

Mặc định `@Cacheable` expire at exact time. Thay vào đó:

```java
public List<Doctor> getAllDoctorsWithSafeExpiry() {
    String cacheKey = "doctors";
    
    // Try get từ cache
    List<Doctor> cached = cacheService.get(cacheKey, List.class);
    if (cached != null) {
        // Check if approaching expiration
        long timeToLiveSeconds = cacheService.getExpiry(cacheKey);
        
        // Nếu cache còn < 10% life, refresh probabilistically
        if (timeToLiveSeconds < 360) {  // 10% of 3600s
            // 10% chance refresh now, 90% serve stale
            if (Math.random() < 0.1) {
                // Background refresh (không block current request)
                executorService.submit(() -> {
                    List<Doctor> fresh = doctorRepository.findAll();
                    cacheService.put(cacheKey, fresh, 3600);
                });
            }
        }
        
        return cached;
    }
    
    // Cache miss, query database
    List<Doctor> doctors = doctorRepository.findAll();
    cacheService.put(cacheKey, doctors, 3600);
    return doctors;
}
```

Cách hoạt động:
- Khi cache còn 10% life, random 10% requests sẽ trigger background refresh
- Requests khác vẫn được serve dari cache
- Khi refresh xong, cache mới replace cache cũ
- Không có thundering herd, vì refresh diễn ra dần dần

---

## Giải pháp 2: Distributed lock (queue requests)

Khi cache miss, acquire lock trước khi query database:

```java
public List<Doctor> getAllDoctorsWithLock() {
    String cacheKey = "doctors";
    List<Doctor> cached = cacheService.get(cacheKey, List.class);
    if (cached != null) return cached;
    
    // Cache miss — try acquire lock
    String lockKey = "lock:" + cacheKey;
    try {
        // Acquire distributed lock với timeout
        boolean acquired = redisService.setNX(lockKey, "1", 5);  // 5s timeout
        
        if (acquired) {
            // I won the lock, query database
            List<Doctor> doctors = doctorRepository.findAll();
            cacheService.put(cacheKey, doctors, 3600);
            return doctors;
        } else {
            // Lock already held by other thread
            // Wait and retry (exponential backoff)
            for (int i = 0; i < 5; i++) {
                Thread.sleep(100 * (i + 1));  // 100ms, 200ms, 300ms...
                cached = cacheService.get(cacheKey, List.class);
                if (cached != null) return cached;
            }
            
            // Timeout waiting for lock, fallback to stale data or error
            return lastKnownValue;
        }
    } finally {
        // Release lock
        redisService.delete(lockKey);
    }
}
```

Cách hoạt động:
- Request #1 cache miss → acquire lock → query database → cache
- Request #2-100 cache miss → lock held → wait → retry → cache hit
- Chỉ 1 query database, 99 requests queue up chờ kết quả

---

## Giải pháp 3: Xtra time (XFetch)

Thêm "extra time" vào cache expiration. Khi key expired, return stale data + background refresh:

```java
public List<Doctor> getAllDoctorsWithXfetch() {
    String cacheKey = "doctors";
    String expiryKey = cacheKey + ":expiry";
    
    List<Doctor> cached = cacheService.get(cacheKey, List.class);
    Long expiryTime = cacheService.get(expiryKey, Long.class);
    
    long now = System.currentTimeMillis();
    
    if (cached != null && expiryTime != null) {
        // Cache exists
        if (now < expiryTime) {
            // Cache fresh
            return cached;
        } else if (now < expiryTime + 300_000) {  // Extra 5 minutes
            // Cache expired but within "extra time" window
            // Return stale + background refresh
            executorService.submit(() -> {
                List<Doctor> fresh = doctorRepository.findAll();
                cacheService.put(cacheKey, fresh);
                cacheService.put(expiryKey, System.currentTimeMillis() + 3600_000);
            });
            return cached;  // Return stale immediately
        }
    }
    
    // Cache miss or beyond extra time
    List<Doctor> doctors = doctorRepository.findAll();
    cacheService.put(cacheKey, doctors);
    cacheService.put(expiryKey, System.currentTimeMillis() + 3600_000);
    return doctors;
}
```

Cách hoạt động:
- Exact expiry (hour mark) → return stale data + async refresh
- Request không chặn chờ query
- 5 minutes later, cache refresh, stale data replaced

---

## Cách detect cache stampede ở HMS

Khi hệ thống lag, check:

```bash
# Check Redis keys, xem bao nhiêu keys expire cùng lúc
redis-cli RANDOMKEY
# Lặp lại, xem pattern

# Check database query log
# Trong 1 second, có bao nhiêu SELECT `doctors`?
SELECT COUNT(*) FROM slow_query_log 
WHERE query LIKE 'SELECT * FROM doctors' 
  AND timestamp BETWEEN NOW() - INTERVAL 1 SECOND AND NOW();

# Check thread dump, xem threads chặn ở đâu
jstack <PID> | grep "Thread.State: WAITING" | wc -l
```

Nếu:
- Tất cả threads state WAITING
- Database saw 100+ same queries in 1 second
- Response time spiked at exact hour marks

→ Cache stampede!

---

## Takeaway

Cache stampede là bug hiếm nhưng catastrophic. Nó xảy ra khi cache expire synchronously + high concurrency. Ba giải pháp:

1. **Probabilistic refresh** — simple, low cost
2. **Distributed lock** — strong guarantee, overhead nhỏ
3. **Xtra time** — serve stale immediately, refresh async

Chọn giải pháp dựa vào data sensitivity. Doctor list (read-only)? Xtra time ok. User authentication (critical)? Distributed lock safer.

---

*Bài tiếp theo: Queue — vì sao không phải lúc nào cũng xử lý request ngay lập tức*
