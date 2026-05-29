---
title: "Tại sao user thấy data cũ dù đã update — cache consistency trong thực tế"
description: "Update profile thành công, reload trang vẫn thấy tên cũ. Cache invalidation là một trong hai vấn đề khó nhất trong computer science — và đây là cách xử lý thực tế."
category: system-design
pubDate: 2024-03-29
series: "Phần 10: Case Studies thực tế"
tags: ["case-study", "caching", "cache-invalidation", "consistency"]
---

Bác sĩ vừa cập nhật lịch làm việc — thêm giờ khám sáng thứ Sáu. Vào admin panel, lịch đã thay đổi. Nhưng bệnh nhân mở app đặt lịch và vẫn không thấy slot thứ Sáu. Refresh. Vẫn không có. F5 thêm vài lần. Mười lăm phút sau mới thấy.

Không có bug trong code logic. Không có race condition. Chỉ là cache chưa expire.

Đây là một trong những vấn đề phổ biến nhất khi làm hệ thống có cache — và cũng là thứ hay bị under-design nhất.

---

## Cache consistency là gì và tại sao khó

Cache consistency đảm bảo rằng data trong cache và data trong database là giống nhau — hoặc ít nhất là "đủ gần" với mức user có thể chấp nhận được.

Từ "đủ gần" là key. Không có hệ thống cache nào có strong consistency hoàn hảo với performance tốt cùng lúc. Đây là trade-off cơ bản: càng đảm bảo consistency, càng nhiều overhead để invalidate và refresh cache.

HMS dùng Redis cache cho schedule data, appointment slots, và patient profile. Mỗi loại data có tolerance khác nhau cho stale data:

- **Doctor schedule:** stale 1-2 phút là chấp nhận được — bệnh nhân đặt lịch không cần realtime
- **Slot availability:** stale vài giây là chấp nhận được — Redis Lua atomic xử lý final check
- **Payment status:** không được stale — user cần biết chính xác trạng thái thanh toán

---

## Cache-aside: pattern cơ bản và vấn đề của nó

Cache-aside (lazy loading) là pattern phổ biến nhất:

```java
// ✅ Pattern đúng nhưng chưa đủ
public DoctorScheduleResponse getDoctorSchedule(UUID scheduleId) {
    String cacheKey = "schedule:" + scheduleId;

    // Check cache trước
    String cached = redisTemplate.opsForValue().get(cacheKey);
    if (cached != null) {
        return objectMapper.readValue(cached, DoctorScheduleResponse.class);
    }

    // Cache miss: query DB và populate cache
    DoctorSchedule schedule = scheduleRepository.findById(scheduleId)
        .orElseThrow(() -> new NotFoundException("Schedule not found"));

    DoctorScheduleResponse response = scheduleMapper.toResponse(schedule);
    redisTemplate.opsForValue().set(
        cacheKey,
        objectMapper.writeValueAsString(response),
        Duration.ofMinutes(15)  // TTL 15 phút
    );

    return response;
}
```

Vấn đề: khi schedule được update, cache vẫn giữ giá trị cũ cho đến khi TTL expire. Với TTL 15 phút, user có thể nhìn thấy data lỗi thời 15 phút.

---

## Write-through: invalidate cache khi update

Giải pháp trực tiếp: xóa (hoặc update) cache ngay khi data thay đổi.

```java
@Service
@RequiredArgsConstructor
public class DoctorScheduleService {

    private final DoctorScheduleRepository scheduleRepository;
    private final RedisTemplate<String, String> redisTemplate;

    @Transactional
    public DoctorScheduleResponse updateSchedule(UUID scheduleId, ScheduleUpdateRequest request) {
        DoctorSchedule schedule = scheduleRepository.findById(scheduleId)
            .orElseThrow(() -> new NotFoundException("Schedule not found"));

        schedule.setMaxPatients(request.getMaxPatients());
        schedule.setStartTime(request.getStartTime());
        schedule.setEndTime(request.getEndTime());
        schedule = scheduleRepository.save(schedule);

        // Invalidate cache sau khi DB update thành công
        // Dùng @TransactionalEventListener thay vì gọi trực tiếp ở đây
        // để đảm bảo chỉ invalidate sau khi transaction commit
        eventPublisher.publishEvent(new ScheduleUpdatedEvent(scheduleId));

        return scheduleMapper.toResponse(schedule);
    }
}
```

```java
@Component
@RequiredArgsConstructor
public class ScheduleCacheInvalidationListener {

    private final RedisTemplate<String, String> redisTemplate;

    @TransactionalEventListener(phase = TransactionPhase.AFTER_COMMIT)
    public void handleScheduleUpdated(ScheduleUpdatedEvent event) {
        String cacheKey = "schedule:" + event.getScheduleId();
        redisTemplate.delete(cacheKey);

        // Nếu có related caches (vd: doctor's schedule list), invalidate luôn
        String doctorScheduleListKey = "doctor:schedules:" + event.getDoctorId();
        redisTemplate.delete(doctorScheduleListKey);
    }
}
```

Lưu ý quan trọng: invalidate trong `AFTER_COMMIT`, không phải trong transaction. Tại sao? Nếu transaction rollback, mày không muốn xóa cache của data vẫn còn valid. (Đây chính là vấn đề ở bài 85, nhưng áp dụng cho cache.)

---

## Vấn đề tiếp theo: cache stampede sau invalidation

Khi xóa cache, next request sẽ cache miss và hit database. Với schedule data của một bác sĩ phổ biến, có thể có hàng chục request đồng thời hit DB cùng lúc — tất cả đều thấy cache miss, tất cả đều query DB, tất cả đều populate cache.

```java
// ❌ Vấn đề: nhiều request đồng thời đều thấy cache miss
public DoctorScheduleResponse getDoctorSchedule(UUID scheduleId) {
    String cacheKey = "schedule:" + scheduleId;
    String cached = redisTemplate.opsForValue().get(cacheKey);
    if (cached != null) {
        return objectMapper.readValue(cached, DoctorScheduleResponse.class);
    }

    // T1, T2, T3 đều vào đây cùng lúc → 3 DB queries thay vì 1
    DoctorSchedule schedule = scheduleRepository.findById(scheduleId)...
    // Tất cả đều set cache — race condition không nguy hiểm, chỉ là lãng phí
    redisTemplate.opsForValue().set(cacheKey, ...);
    return scheduleMapper.toResponse(schedule);
}
```

HMS giải quyết bằng mutex lock cho cache repopulation:

```java
// ✅ Chỉ một request được phép repopulate cache
public DoctorScheduleResponse getDoctorSchedule(UUID scheduleId) {
    String cacheKey = "schedule:" + scheduleId;

    // Kiểm tra cache trước
    String cached = redisTemplate.opsForValue().get(cacheKey);
    if (cached != null) {
        return objectMapper.readValue(cached, DoctorScheduleResponse.class);
    }

    // Dùng distributed lock để chỉ một request query DB
    String lockKey = "lock:schedule:" + scheduleId;
    Boolean acquired = redisTemplate.opsForValue()
        .setIfAbsent(lockKey, "1", Duration.ofSeconds(5)); // 5s lock timeout

    if (Boolean.TRUE.equals(acquired)) {
        try {
            // Double-check: request khác có thể đã populate cache khi tao đang wait
            cached = redisTemplate.opsForValue().get(cacheKey);
            if (cached != null) {
                return objectMapper.readValue(cached, DoctorScheduleResponse.class);
            }

            // Chỉ mình tao query DB
            DoctorSchedule schedule = scheduleRepository.findById(scheduleId)
                .orElseThrow(() -> new NotFoundException("Schedule not found"));

            DoctorScheduleResponse response = scheduleMapper.toResponse(schedule);
            redisTemplate.opsForValue().set(
                cacheKey,
                objectMapper.writeValueAsString(response),
                Duration.ofMinutes(15)
            );
            return response;

        } finally {
            redisTemplate.delete(lockKey); // Release lock
        }
    } else {
        // Không acquire được lock: request khác đang repopulate
        // Chờ ngắn rồi retry
        try {
            Thread.sleep(100);
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
        }
        // Recursive call — trong thực tế nên dùng retry loop với max attempts
        return getDoctorSchedule(scheduleId);
    }
}
```

---

## Phân tầng cache theo tolerance

Không phải tất cả data cần cùng một invalidation strategy. HMS nhóm data theo "stale tolerance":

```java
@Component
public class CacheConfig {

    // Schedule list: OK nếu stale 5 phút, invalidate khi có update
    public static final Duration SCHEDULE_TTL = Duration.ofMinutes(5);

    // Slot availability: chỉ cache rất ngắn, invalidation là bước cuối
    // Redis Lua script là primary mechanism — cache ở đây chỉ là optimization
    public static final Duration SLOT_AVAILABILITY_TTL = Duration.ofSeconds(30);

    // Patient profile: stable data, cache dài hơn
    public static final Duration PATIENT_PROFILE_TTL = Duration.ofHours(1);

    // Payment status: không cache, luôn query DB
    // Data quá sensitive để chấp nhận stale state
}
```

Quyết định TTL không phải là technical decision đơn thuần — nó là product decision. "User chấp nhận thấy schedule cũ trong bao lâu?" cần product owner trả lời, không phải developer tự quyết.

---

## Takeaway

Cache consistency không có giải pháp one-size-fits-all. Câu hỏi đúng không phải "dùng pattern gì" mà là "data này có thể stale trong bao lâu mà user vẫn ổn?" Trả lời câu đó xong, pattern sẽ tự rõ ràng.

---

*Bài tiếp theo: Một cái tên đặt sai gây ra bug production*
