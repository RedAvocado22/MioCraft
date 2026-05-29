---
title: "Connection Pool — vì sao hàng ngàn request chỉ cần vài chục connection"
description: "Tạo database connection tốn kém. Connection pool tái sử dụng connection — nhưng pool quá nhỏ thì bottleneck, pool quá lớn thì database overload."
category: system-design
pubDate: 2024-02-27
series: "Phần 6: Database"
tags: ["database", "connection-pool", "performance"]
---

Mày có HMS. 1000 user online cùng lúc. Khi query database, mỗi user request cần một **connection** (TCP socket tới MySQL server).

Nếu 1000 request = 1000 connection, cái này chết — MySQL mỗi connection tốn memory, lại có limit (default max_connections = 151).

Nhưng thực tế, 1000 request chỉ cần ~30 connections. Vì sao? **Connection Pool** — một queue manage connections được reuse.

---

## Connection là gì? Tại sao nó đắt?

Khi Spring Boot query database:

1. Open TCP socket tới MySQL (handshake, auth) — ~100ms
2. Execute query — ~1ms
3. Close connection — ~1ms

Nghe qua không lâu, nhưng nhân 1000 user = **100 giây chỉ để open connection**. Bất khả thi.

**Connection Pool fix này:** Không close connection sau mỗi query. Keep alive, reuse cho query tiếp theo.

---

## Cách connection pool hoạt động

Có một **pool** chứa N connections (mặc định N=10). Khi request đến:

```
Request 1:
  Borrow connection #1 từ pool
  Execute query
  Return connection #1 tới pool (không close)

Request 2 (vài ms sau):
  Borrow connection #2 từ pool
  Execute query
  Return connection #2 tới pool

Request 3 (sau khi request 1 return connection #1):
  Borrow connection #1 (vừa được return!)
  Execute query
  Return connection #1
```

Cùng một connection #1 được reuse cho request 1, 3, 5, ... Mỗi connection sống suốt cả ngày (hoặc tới timeout).

---

## Pool size — bao nhiêu là đủ?

Quy tắc:

```
Pool size = (core_threads * 2) + small_buffer

Ví dụ:
Server có 4 cores
Pool size = (4 * 2) + 1 = 9 connections
```

Tại sao? Không phải càng lớn càng tốt. Vì:

**Risk 1 — Quá ít:**
```
Pool size = 5, có 20 request concurrent
5 connections busy
15 requests chờ connection (waiting)
Queue grow, request timeout
```

**Risk 2 — Quá nhiều:**
```
Pool size = 200, nhưng server chỉ xử lý 20 requests/sec
180 connections idle, tốn memory
MySQL server overload vì manage 200 connections
```

**Optimal:** Đủ xử lý peak concurrent request, không thừa.

---

## Cách config HikariCP trong Spring Boot

Spring Boot dùng HikariCP (nhanh nhất). Config ở application.yml:

```yaml
spring:
  datasource:
    hikari:
      maximum-pool-size: 20          # Max connections
      minimum-idle: 5                # Min idle connections (warm-up)
      connection-timeout: 30000      # Timeout 30s (request chờ connection)
      idle-timeout: 600000           # Idle 10 mins → close connection
      max-lifetime: 1800000          # Connection sống max 30 mins
```

**maximum-pool-size:** Tối đa bao nhiêu connections. Peak load, tất cả connections busy.

**minimum-idle:** Keep warm bao nhiêu connections ngay cả khi không dùng. Vì open connection chậm, tốt hơn keep warm.

**connection-timeout:** Nếu pool full (tất cả connections busy) và request đến, chờ bao lâu để có connection. Sau timeout → error.

**idle-timeout:** Nếu connection idle (không dùng) bao lâu, close để free resource.

**max-lifetime:** Connection tối đa sống bao lâu, sau đó close và open cái mới. Vì connection lâu dần thành unreliable.

---

## Debugging — connection pool issues

**Vấn đề 1 — "Cannot get a connection, pool error"**

```
Meaning: Pool full, mọi connection busy, request mới timeout
Cause: Quá ít connections + slow queries holding connection
Fix: Tăng maximum-pool-size hoặc optimize slow query
```

**Vấn đề 2 — Memory leak từ connection**

```
Meaning: Connection không được return (application bug)
Cause: Exception trong transaction, không close resource
Fix: Dùng try-with-resources hoặc @Transactional auto-close
```

```java
// ❌ Xấu — connection leak nếu exception
Connection conn = dataSource.getConnection();
conn.executeUpdate(...);
conn.close(); // Nếu exception, không được chạy

// ✅ Tốt — auto-close
try (Connection conn = dataSource.getConnection()) {
    conn.executeUpdate(...);
} // Auto-close, dù exception

// ✅ Or dùng @Transactional
@Transactional
public void doSomething() {
    // Spring tự động manage connection
}
```

**Vấn đề 3 — Connection timeout, nhưng server không busy?**

```
Meaning: Request timeout chờ connection, dù pool size 20, chỉ 5 connections busy
Cause: Connections không được return (hung)
Debug:
  1. Check active connections: SELECT * FROM information_schema.PROCESSLIST;
  2. Nếu >20, mày có connection leak
  3. Xem query đang chạy (command), có nói hang query không
```

---

## Ví dụ HMS — optimize connection pool

HMS default config:

```yaml
maximum-pool-size: 10
minimum-idle: 2
```

Load test: 100 concurrent users booking appointments.

Result:
```
Pool exhausted, request timeout
```

Analysis:
- Mỗi booking query → lock appointment row → update → commit
- Lock hold connection → không release ngay
- 100 user, 10 connections → 90 user chờ
- 30s timeout → user see error

**Fix:**

```yaml
maximum-pool-size: 30
minimum-idle: 10
connection-timeout: 60000
```

Tăng pool, tăng timeout, keep warm connections.

**Better fix — optimize booking query:**

```java
// ❌ Slow — lock hold connection lâu
@Transactional(isolation = Isolation.REPEATABLE_READ)
public void book(UUID scheduleId) {
    Schedule s = repo.findById(scheduleId).lock();
    s.decrement();
    repo.save(s);
    sendNotification(...); // Slow I/O, connection still busy!
}
```

```java
// ✅ Fast — release connection sớm
@Transactional(isolation = Isolation.REPEATABLE_READ)
public void book(UUID scheduleId) {
    Schedule s = repo.findById(scheduleId).lock();
    s.decrement();
    repo.save(s);
    // Connection released here (transaction end)
}

@Async
private void sendNotificationAsync(UUID scheduleId) {
    // Async, không hold connection
    sendNotification(...);
}
```

Ngay sau transaction commit, connection released. sendNotification chạy async, không hold pool.

Now 100 concurrent users fit vào 10-20 connections.

---

## Cách monitor connection pool health

```java
@Component
public class PoolHealthIndicator {
    @Autowired
    private DataSource dataSource;
    
    @Scheduled(fixedDelay = 60000)
    public void checkPool() {
        if (dataSource instanceof HikariDataSource) {
            HikariDataSource hds = (HikariDataSource) dataSource;
            int active = hds.getHikariPoolMXBean().getActiveConnections();
            int idle = hds.getHikariPoolMXBean().getIdleConnections();
            int max = hds.getMaximumPoolSize();
            
            double utilization = (double) active / max * 100;
            
            logger.info("Pool: active={}, idle={}, max={}, utilization={}%", 
                active, idle, max, utilization);
            
            if (utilization > 90) {
                logger.warn("Pool near capacity!");
            }
        }
    }
}
```

Monitor log:
```
Pool: active=8, idle=2, max=10, utilization=80%
```

Nếu thường >90%, tăng pool size.

---

## Takeaway

Connection Pool không phải tuning magic, là mechanism để reuse TCP connection. Size nó dựa trên concurrent load, không arbitrary. Monitor utilization, adjust nếu cần, nhưng optimize query first — tốt hơn tăng pool size.

---

*Phần 6 — Database thực chiến: XONG*
