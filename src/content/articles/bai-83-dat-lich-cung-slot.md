---
title: "2 người đặt lịch cùng 1 slot — Redis Lua atomic giải quyết thế nào"
description: "Race condition trong booking system: hai người cùng thấy slot trống, cùng đặt, cả hai thành công — nhưng chỉ có một slot. Redis Lua script và atomic operation là giải pháp."
category: system-design
pubDate: 2024-03-24
series: "Phần 10: Case Studies thực tế"
tags: ["case-study", "Redis", "concurrency", "race-condition"]
---

Hệ thống booking có một bài toán kinh điển mà sinh viên thường không nghĩ đến cho đến khi nó xảy ra thật: hai người dùng cùng nhìn thấy một slot trống, cùng bấm đặt lịch, và cả hai đều nhận được confirmation.

Bác sĩ giờ có hai bệnh nhân vào đúng 9 giờ sáng thứ Hai. Không ai báo lỗi. Hệ thống không crash. Chỉ là dữ liệu sai theo cách rất khó phát hiện.

Đây là race condition — và trong HMS, đây là bug thật mà mình phải ngồi giải quyết.

---

## Vấn đề không nằm ở database transaction

Phản xạ đầu tiên của hầu hết dev là: *"Dùng database transaction là xong."* Và đó là câu trả lời đúng... cho bài toán khác.

Với slot booking, flow cơ bản trông như thế này:

```java
// ❌ Vấn đề — check rồi mới act, nhưng hai thứ không atomic
@Transactional
public BookingResult bookSlot(UUID scheduleId, UUID patientId) {
    DoctorSchedule schedule = scheduleRepository.findById(scheduleId)
        .orElseThrow(() -> new NotFoundException("Schedule not found"));

    // T1 và T2 đều đọc currentPatients = 4, maxPatients = 5
    // Cả hai đều thấy "còn slot"
    if (schedule.getCurrentPatients() >= schedule.getMaxPatients()) {
        throw new SlotFullException("No available slots");
    }

    // T1 increment lên 5, T2 cũng increment lên 5
    // Kết quả: currentPatients = 5 nhưng có 2 appointment được tạo
    schedule.setCurrentPatients(schedule.getCurrentPatients() + 1);
    scheduleRepository.save(schedule);

    return createAppointment(schedule, patientId);
}
```

`@Transactional` đảm bảo mỗi transaction là consistent với chính nó — nhưng không ngăn được hai transaction đọc cùng một giá trị trước khi transaction kia commit. Đây là Phantom Read / Lost Update, một vấn đề mà Serializable isolation level có thể giải quyết — nhưng cái giá là lock contention và performance sụt giảm nghiêm trọng.

Vấn đề sâu hơn: hệ thống HMS dùng Redis để cache slot availability cho performance. Check slot ở tầng Redis trước khi chạm database là pattern đang được dùng. Và Redis là single-threaded — đây là hint quan trọng.

---

## Tại sao Redis Lua script là giải pháp đúng

Redis có hai đặc điểm khi kết hợp lại tạo ra giải pháp hoàn hảo cho race condition dạng này:

**Thứ nhất:** Redis là single-threaded. Mọi command đều được xử lý tuần tự — không có parallel execution ở tầng Redis.

**Thứ hai:** Lua script trên Redis là atomic. Khi một script đang chạy, không có command nào khác được xử lý. Script chạy xong mới đến lượt command tiếp theo.

Hai đặc điểm này cộng lại: check-and-increment trong một Lua script là một operation không thể bị interrupted. Không có window nào để race condition xảy ra.

```lua
-- Script này chạy atomic trên Redis
-- KEYS[1]: slot key (vd: "slot:schedule:abc123")
-- ARGV[1]: max capacity

local current = tonumber(redis.call('GET', KEYS[1])) or 0
local max = tonumber(ARGV[1])

-- Check và increment xảy ra trong cùng một atomic operation
if current >= max then
    return -1  -- Slot đầy
end

-- Tăng counter và set TTL để tự clean up nếu booking fail
local new_count = redis.call('INCR', KEYS[1])
redis.call('EXPIRE', KEYS[1], 300)  -- 5 phút TTL

return new_count  -- Trả về slot number vừa được giữ
```

Và bên Java:

```java
@Service
@RequiredArgsConstructor
public class SlotBookingService {

    private final RedisTemplate<String, String> redisTemplate;
    private final AppointmentRepository appointmentRepository;
    private final DoctorScheduleRepository scheduleRepository;

    // Load script một lần, dùng SHA để tránh re-send script mỗi lần
    private DefaultRedisScript<Long> bookingScript;

    @PostConstruct
    public void init() {
        bookingScript = new DefaultRedisScript<>();
        bookingScript.setScriptText(BOOKING_LUA_SCRIPT);
        bookingScript.setResultType(Long.class);
    }

    @Transactional
    public AppointmentResponse bookSlot(UUID scheduleId, UUID patientId) {
        DoctorSchedule schedule = scheduleRepository.findById(scheduleId)
            .orElseThrow(() -> new NotFoundException("Schedule not found"));

        String slotKey = "slot:schedule:" + scheduleId;

        // Atomic check-and-increment — đây là điểm không thể có race condition
        Long result = redisTemplate.execute(
            bookingScript,
            List.of(slotKey),
            String.valueOf(schedule.getMaxPatients())
        );

        if (result == null || result == -1) {
            throw new SlotFullException("No available slots for this schedule");
        }

        // Redis đã "giữ" slot — bây giờ mới persist vào database
        // Nếu DB fail, cần compensation để release slot
        return createAndPersistAppointment(schedule, patientId, slotKey);
    }

    private AppointmentResponse createAndPersistAppointment(
        DoctorSchedule schedule,
        UUID patientId,
        String slotKey
    ) {
        try {
            // Update database counter — dùng optimistic lock để safety net
            schedule.setCurrentPatients(schedule.getCurrentPatients() + 1);
            scheduleRepository.save(schedule);

            Appointment appointment = Appointment.builder()
                .schedule(schedule)
                .patientId(patientId)
                .status(AppointmentStatus.CONFIRMED)
                .build();

            return appointmentMapper.toResponse(appointmentRepository.save(appointment));

        } catch (Exception e) {
            // Compensation: nếu DB fail, release Redis slot đã giữ
            redisTemplate.execute(
                releaseSlotScript,
                List.of(slotKey)
            );
            throw new BookingException("Failed to persist booking", e);
        }
    }
}
```

---

## Vấn đề tiếp theo: Redis và Database có thể lệch nhau

Dùng Lua script giải quyết được race condition — nhưng mở ra một vấn đề mới: Redis counter và database counter có thể lệch nhau nếu có sự cố.

Scenario: Redis đã increment, database transaction thành công, nhưng sau đó service restart trước khi Redis được sync đúng cách. Hoặc ngược lại: DB commit thành công, nhưng Redis TTL đã expire và counter reset về 0.

HMS giải quyết việc này bằng một reconciliation job chạy định kỳ:

```java
@Scheduled(fixedDelay = 60_000) // chạy mỗi phút
public void reconcileSlotCounters() {
    List<DoctorSchedule> activeSchedules = scheduleRepository
        .findByDateGreaterThanEqualAndActiveTrue(LocalDate.now());

    for (DoctorSchedule schedule : activeSchedules) {
        String slotKey = "slot:schedule:" + schedule.getId();
        
        // Đếm actual confirmed appointments từ DB — đây là source of truth
        long actualCount = appointmentRepository
            .countByScheduleIdAndStatusNot(schedule.getId(), AppointmentStatus.CANCELLED);

        // Sync Redis về đúng giá trị DB
        redisTemplate.opsForValue().set(slotKey, String.valueOf(actualCount));
        
        // Cập nhật cả DB counter nếu lệch
        if (schedule.getCurrentPatients() != actualCount) {
            schedule.setCurrentPatients((int) actualCount);
            scheduleRepository.save(schedule);
            
            log.warn("Slot counter reconciled for schedule {}: {} -> {}",
                schedule.getId(), schedule.getCurrentPatients(), actualCount);
        }
    }
}
```

Pattern này — **optimistic fast path với Lua, pessimistic reconciliation ở background** — cho phép hệ thống vừa nhanh vừa eventually consistent.

---

## Điều quan trọng hơn solution

Điều đáng chú ý không phải là Lua script hay Redis INCR. Điều đáng chú ý là *cách bài toán được nhìn nhận*.

Race condition dạng này không bao giờ xuất hiện trong test đơn giản. Bạn phải chủ động nghĩ: *"Điều gì xảy ra nếu hai request này đến cùng một lúc?"* Người có kinh nghiệm có thói quen đó. Người mới thường không có — cho đến khi bug xảy ra trên production.

Mỗi lần bạn viết một operation gồm hai bước: **read** rồi **write** dựa trên kết quả của read — đó là lúc bạn cần dừng lại và hỏi: *hai bước này có atomic không?* Nếu không, race condition đang chờ.

---

## Takeaway

Check-then-act không bao giờ an toàn nếu hai bước đó không phải một atomic operation. Redis Lua script cho phép bạn đưa cả check và act vào một unit không thể bị interrupted — và đó là thứ database transaction thông thường không làm được ở tầng cache.

---

*Bài tiếp theo: User bấm thanh toán 2 lần — idempotency key hoạt động ra sao*
