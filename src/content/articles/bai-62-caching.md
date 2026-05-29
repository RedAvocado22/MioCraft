---
title: "Caching — vì sao server không query database mỗi lần"
description: "Cache là một trong những công cụ mạnh nhất để tăng performance — và cũng là nguồn gốc của những bug khó chịu nhất. Hiểu caching strategy trước khi implement."
category: system-design
pubDate: 2024-03-03
series: "Phần 7: Backend & Hệ thống"
tags: ["caching", "Redis", "performance"]
---

Một optimization tuyệt vời nhất mà cậu sẽ khi HMS scale lên là **cache**. Nhưng caching cũng là thứ dễ làm sai nhất.

Cậu đã dùng Redis ở HMS. Nhưng cậu có biết: caching không phải "tất cả data vào Redis, bài toán giải quyết"? Cache strategy sai có thể làm hệ thống **chậm hơn lúc không cache**, vì overhead của cache vượt lợi ích.

---

## Caching là gì — và tại sao nó quan trọng

Mỗi database query tốn chi phí:

- Network round trip tới MySQL
- Query execution (lock, scan, join)
- Transfer result set
- CPU overhead

Một query `SELECT * FROM doctors` có thể tốn 50ms. Với 10 requests/second, HMS tốn 500ms tổng cộng để fetch doctor list.

**Cache** lưu result trong memory (Redis hoặc local cache). Lần sau fetch từ memory (~1ms thay vì 50ms).

```
Request 1: Query database → 50ms → Cache (Redis) → Respond
Request 2: Get from cache   → 1ms  → Respond
Request 3: Get from cache   → 1ms  → Respond
...
Request 100: Get from cache → 1ms  → Respond
```

Sau 100 requests, cậu save 4.9 seconds so với không cache.

---

## Caching strategy 1: Lazy Loading (demand-driven)

Giống pattern mà cậu đang dùng:

```java
@Cacheable("doctors")
public List<Doctor> getAllDoctors() {
    // Lần đầu: query database, store ở cache
    return doctorRepository.findAll();
    // Lần sau: get từ cache, không query
}
```

Cách hoạt động:
1. Request đầu tiên gọi hàm → cache miss → query database → store result → respond
2. Request tiếp theo → cache hit → return from cache → respond (nhanh)
3. Khi cache expires (ví dụ: 1 hour), quay lại step 1

**Lợi:**
- Đơn giản, dễ implement
- Chỉ cache data được access

**Vấn đề:**
- **Cache miss penalty** — request đầu tiên sau expire phải hit database. Nếu query tốn 1 second, request user sẽ chờ 1 second.
- **Stale data** — nếu data trong database thay đổi, cache vẫn cũ. Doctor bị update, user vẫn thấy doctor cũ cho đến khi cache expire.

---

## Caching strategy 2: Write-through (invalidate on update)

Khi data thay đổi, invalidate cache:

```java
@Cacheable("doctors")
public List<Doctor> getAllDoctors() {
    return doctorRepository.findAll();
}

@CacheEvict("doctors")  // ← Clear cache khi update
@Transactional
public Doctor updateDoctor(UUID id, DoctorRequest req) {
    Doctor doctor = doctorRepository.findById(id).orElseThrow();
    doctor.setName(req.getName());
    doctor.setSpecialization(req.getSpecialization());
    return doctorRepository.save(doctor);
}
```

Cách hoạt động:
1. Get doctors → cache miss → query database → store cache
2. Update doctor A → clear cache
3. Get doctors again → cache miss → query database (có doctor A cập nhật) → store cache

**Lợi:**
- Data luôn fresh
- No stale data issue

**Vấn đề:**
- **Cache stampede** — khi cache bị clear, 100 requests đồng thời hit miss. Tất cả gọi database. Database overload.
- **Overhead nếu updates hay** — nếu doctors được update mỗi giây, cache luôn bị clear, lợi ích cache giảm.

---

## Caching strategy 3: Write-behind (queue updates)

Không update database ngay, update cache, rồi queue update để db sync async:

```java
public void updateDoctorAsync(UUID id, DoctorRequest req) {
    // Update cache ngay
    Doctor doctor = new Doctor(...);
    cacheService.put("doctor:" + id, doctor);
    
    // Queue update để database sync lâu dần
    updateQueue.enqueue(new UpdateTask(id, req));
}

// Background job
@Scheduled(fixedRate = 1000)
public void processPendingUpdates() {
    while (!updateQueue.isEmpty()) {
        UpdateTask task = updateQueue.dequeue();
        doctorRepository.save(task.doctor);
    }
}
```

Lợi: Respond ngay, không chặn database.
Vấn đề: Cache-DB có thể out of sync nếu system crash. Chỉ dùng cho data không critical.

---

## Cách chọn strategy cho HMS

**Doctor List:**
- Thay đổi hiếm (có thể 1 lần/tuần)
- High read (10000+ requests/day)
- Stale data acceptable (30 phút lag OK)
→ **Lazy loading + long TTL (30 minutes)**

```java
@Cacheable(value = "doctors", cacheManager = "redisCacheManager")
@Transactional(readOnly = true)
public List<DoctorListDto> getAllDoctorsForUI() {
    return doctorRepository.findAll()
        .stream()
        .map(doctorMapper::toListDto)
        .toList();
}

// Invalidate khi admin update doctor
@CacheEvict(value = "doctors", allEntries = true)
public Doctor updateDoctor(UUID id, DoctorRequest req) { ... }
```

**User Insurance Info:**
- Thay đổi thường (user cập nhật bảo hiểm)
- Medium read (1000+ requests/day)
- Stale data NOT acceptable (booking phải có insurance info đúng)
→ **Write-through + short TTL (5 minutes) + cache-aside**

```java
@Cacheable(value = "insurance", key = "#userId", cacheManager = "redisCache")
public InsuranceInfo getUserInsurance(UUID userId) {
    // Keycloak API
    return keycloakService.getInsurance(userId);
}

// Khi user update insurance
@CacheEvict(value = "insurance", key = "#userId")
@Transactional
public void updateInsurance(UUID userId, InsuranceRequest req) {
    keycloakService.updateInsurance(userId, req);
}
```

**Appointment Slots (Real-time booking):**
- Thay đổi very frequently (mỗi booking thay đổi slot)
- Critical consistency (không thể overbook)
- Do NOT cache, hoặc dùng distributed lock
→ **No caching, hoặc Redis Lua atomic script** (bài sau)

---

## Caching pitfall 1: Cache stampede (thundering herd)

Khi cache key expires, 100 requests đồng thời miss cache:

```
Time 0:00   - Cache miss #1 → Query database → Store (100ms)
Time 0:00   - Cache miss #2 → Query database → Store (100ms)  ← Parallel
Time 0:00   - Cache miss #3 → Query database → Store (100ms)  ← Parallel
...
Time 0:00   - Cache miss #100 → Query database → Store (100ms)
```

Trong 100ms, database bị 100 requests đánh. Nếu query tốn 50ms, database bị overload.

**Solution:**

```java
// Probabilistic early expiration
@Cacheable(value = "doctors")
public List<Doctor> getAllDoctors() {
    return doctorRepository.findAll();
}

// Refresh cache trước khi expire
@Scheduled(fixedRate = 25 * 60 * 1000)  // 25 minutes, TTL = 30 min
public void refreshDoctorCache() {
    List<Doctor> doctors = doctorRepository.findAll();
    cacheService.put("doctors", doctors);
    // Cache updated, next request sẽ hit fresh data
}
```

Hoặc dùng **cache-aside pattern**:

```java
public List<Doctor> getDoctorsWithFallback() {
    try {
        return cacheService.get("doctors", List.class);
    } catch (CacheException e) {
        // Khi cache miss/error, background job fetch, main request return cached stale data
        backgroundJobQueue.enqueue(() -> doctorRepository.findAll());
        return lastKnownValue;  // Stale but available
    }
}
```

---

## Caching pitfall 2: Cache invalidation problem

Phil Karlton: *"There are only two hard things in Computer Science: cache invalidation and naming things."*

Nếu cậu clear cache sai, user sẽ thấy cũ data. Nếu cậu forget clear cache, sẽ worse.

```java
// ❌ Vấn đề: forget clear cache
@Transactional
public Doctor updateDoctor(UUID id, DoctorRequest req) {
    Doctor doctor = doctorRepository.findById(id).orElseThrow();
    doctor.setName(req.getName());
    doctorRepository.save(doctor);
    // Forget: @CacheEvict
    return doctor;
}
// Result: User update doctor, cache vẫn cũ, user thấy tên cũ
```

**Solution: Transaction + event-driven invalidation**

```java
@Transactional
@TransactionalEventListener(phase = TransactionPhase.AFTER_COMMIT)
public void onDoctorUpdated(DoctorUpdatedEvent event) {
    cacheService.invalidate("doctors");
    cacheService.invalidate("doctor:" + event.getDoctorId());
}

// Publish event khi update
@Transactional
public Doctor updateDoctor(UUID id, DoctorRequest req) {
    Doctor doctor = doctorRepository.findById(id).orElseThrow();
    doctor.setName(req.getName());
    Doctor saved = doctorRepository.save(doctor);
    
    eventPublisher.publishEvent(new DoctorUpdatedEvent(saved.getId()));
    return saved;
}
```

Event được publish sau transaction commit, đảm bảo DB được update xong rồi mới clear cache.

---

## Takeaway

Cache là powerful nhưng tricky. Chọn strategy dựa vào: **how often data changes vs how often it's accessed**.

Lazy loading ok cho read-heavy, rarely-changing data (doctor list). Write-through ok cho write-heavy, consistency-critical data (insurance). Forget invalidation = consistent bugs. Event-driven invalidation = safer.

---

*Bài tiếp theo: Cache Stampede — khi cache sập gây sập cả hệ thống*
