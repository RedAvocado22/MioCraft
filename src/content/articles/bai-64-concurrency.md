---
title: "Concurrency — khi nhiều request cùng chạm một tài nguyên"
description: "Race condition, lost update, dirty read — đây là những vấn đề xảy ra khi concurrent requests cùng thao tác trên một dữ liệu. Và chúng chỉ xảy ra trong production."
category: system-design
pubDate: 2024-03-05
series: "Phần 7: Backend & Hệ thống"
tags: ["concurrency", "race-condition", "distributed-systems"]
---

Một lỗi nổi tiếng ở HMS: hai user đặt lịch khám cùng 1 slot.

Doctor A có schedule:
- Date: 2025-06-01
- Time: 10:00-11:00
- Max patients: 1

User X bấm "Book" lúc 10:00:00.001
User Y bấy "Book" lúc 10:00:00.002

Cả hai requests đều:
1. Query database: SELECT current_patients FROM schedule WHERE id = ?
2. Check: current_patients < max_patients? ✓ (0 < 1)
3. Insert appointment
4. Update: current_patients = 1

Nhưng vì cả hai requests chạy **song song**, cả hai đều thấy current_patients = 0. Cả hai insert. Kết quả: **2 appointments cho 1 slot**.

Đó là **race condition**.

---

## Race condition là gì

Race condition xảy ra khi:
- Nhiều requests cùng access **một tài nguyên share** (database row)
- **Không có synchronization** (lock, transaction isolation)
- **Operations không atomic** (multiple steps, giữa mỗi step có gap cho request khác modify)

```java
// ❌ Race condition
@Transactional
public Appointment bookAppointment(UUID scheduleId, UUID userId) {
    // Step 1: Read
    DoctorSchedule schedule = scheduleRepository.findById(scheduleId).orElseThrow();
    int current = schedule.getCurrentPatients();  // 0
    
    // ← Race condition window! Request khác modify schedule ở đây
    
    // Step 2: Check
    if (current < schedule.getMaxPatients()) {
        // Step 3: Modify
        schedule.setCurrentPatients(current + 1);
        scheduleRepository.save(schedule);
        
        Appointment app = new Appointment(scheduleId, userId);
        return appointmentRepository.save(app);
    }
}
```

Giữa Step 1 và Step 3, request khác có thể vào và modify schedule. Kết quả: lost update.

---

## Solution 1: Pessimistic locking (SELECT FOR UPDATE)

Tell database: **lock row ngay khi read, release khi transaction commit**:

```java
@Transactional
public Appointment bookAppointment(UUID scheduleId, UUID userId) {
    // SELECT ... FOR UPDATE — lock row
    DoctorSchedule schedule = scheduleRepository.findByIdForUpdate(scheduleId);
    // ← Ngay lúc này, row bị lock. Requests khác chờ.
    
    if (schedule.getCurrentPatients() < schedule.getMaxPatients()) {
        schedule.setCurrentPatients(schedule.getCurrentPatients() + 1);
        scheduleRepository.save(schedule);
        
        Appointment app = new Appointment(scheduleId, userId);
        appointmentRepository.save(app);
        return app;
    }
    // Lock released khi transaction commit
}

// Repository
@Repository
public interface DoctorScheduleRepository extends JpaRepository<DoctorSchedule, UUID> {
    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("SELECT s FROM DoctorSchedule s WHERE s.id = ?1")
    DoctorSchedule findByIdForUpdate(UUID id);
}
```

Cách hoạt động:
```
Time 10:00:00.001 - User X: Lock schedule
Time 10:00:00.002 - User Y: Try lock schedule → BLOCK (chờ User X)
Time 10:00:00.003 - User X: Read (0), Update (1), Commit → Release lock
Time 10:00:00.004 - User Y: Lock acquired, Read (1), Check (1 < 1?) ✗ → FAIL
```

Lợi:
- Strong guarantee — chỉ 1 request sửa được
- Simple implementation

Vấn đề:
- **Deadlock risk** — nếu 2 requests lock nhiều rows theo order khác nhau, deadlock xảy ra
- **Performance** — lock tốn time, requests queue up
- Chỉ hoạt động với database yang support SELECT FOR UPDATE

---

## Solution 2: Optimistic locking (version field)

Không lock. Thêm `version` field. Khi update, check version match:

```java
@Entity
@Table(name = "doctor_schedules")
public class DoctorSchedule {
    @Id
    private UUID id;
    
    @Version  // ← Optimistic lock field
    private Long version;
    
    private int currentPatients;
    private int maxPatients;
}

@Transactional
public Appointment bookAppointment(UUID scheduleId, UUID userId) {
    // No lock, just read
    DoctorSchedule schedule = scheduleRepository.findById(scheduleId).orElseThrow();
    // schedule.version = 5
    
    if (schedule.getCurrentPatients() < schedule.getMaxPatients()) {
        schedule.setCurrentPatients(schedule.getCurrentPatients() + 1);
        // ← Hibernate sẽ generate:
        //   UPDATE doctor_schedules 
        //   SET current_patients = ?, version = version + 1
        //   WHERE id = ? AND version = 5
        
        scheduleRepository.save(schedule);  // ← Throws StaleObjectStateException if version != 5
        
        Appointment app = new Appointment(scheduleId, userId);
        return appointmentRepository.save(app);
    }
}
```

Cách hoạt động:
```
Time 10:00:00.001 - User X: Read schedule (version = 5)
Time 10:00:00.002 - User Y: Read schedule (version = 5)
Time 10:00:00.003 - User X: Update → UPDATE WHERE version = 5 ✓
                             version becomes 6
Time 10:00:00.004 - User Y: Update → UPDATE WHERE version = 5 ✗ (version now = 6)
                             StaleObjectStateException thrown
```

Lợi:
- No lock, better performance
- No deadlock

Vấn đề:
- Retry logic phức tạp — khi update fail, client phải retry
- Không tốt cho high contention (ví dụ: hot slot, 100 users book cùng lúc)

---

## Solution 3: Distributed lock (Redis)

Không dùng database lock. Dùng Redis:

```java
@Component
public class SlotBookingService {
    private final RedisTemplate<String, String> redis;
    
    public Appointment bookAppointment(UUID scheduleId, UUID userId) {
        String lockKey = "schedule:" + scheduleId;
        String lockValue = UUID.randomUUID().toString();
        
        // Try acquire lock — expire after 10 seconds (safety)
        Boolean acquired = redis.opsForValue().setIfAbsent(lockKey, lockValue, Duration.ofSeconds(10));
        
        if (!acquired) {
            // Lock already held
            throw new SlotNotAvailableException("Slot is being booked");
        }
        
        try {
            return doBook(scheduleId, userId);
        } finally {
            // Release lock dùng Lua script để đảm bảo atomic check-and-delete
            // GET rồi DELETE riêng lẻ có race condition: giữa hai bước, lock có thể expire
            // và được acquire bởi process khác, rồi bị delete nhầm
            String luaScript = "if redis.call('get', KEYS[1]) == ARGV[1] then " +
                               "return redis.call('del', KEYS[1]) else return 0 end";
            redis.execute(new DefaultRedisScript<>(luaScript, Long.class),
                         Collections.singletonList(lockKey), lockValue);
        }
    }
    
    @Transactional
    private Appointment doBook(UUID scheduleId, UUID userId) {
        DoctorSchedule schedule = scheduleRepository.findById(scheduleId).orElseThrow();
        
        if (schedule.getCurrentPatients() < schedule.getMaxPatients()) {
            schedule.setCurrentPatients(schedule.getCurrentPatients() + 1);
            scheduleRepository.save(schedule);
            
            Appointment app = new Appointment(scheduleId, userId);
            return appointmentRepository.save(app);
        }
        
        throw new SlotNotAvailableException("No available slots");
    }
}
```

Lợi:
- Works across multiple servers (nếu cậu có distributed HMS)
- No database deadlock
- Can implement queue (lock not acquired → queue request)

Vấn đề:
- Requires Redis (another dependency)
- Lock lost nếu Redis crash (weaker than DB locks)

---

## Solution 4: Atomic operation (best)

Dùng single atomic statement, không cần lock:

```java
@Transactional
public Appointment bookAppointment(UUID scheduleId, UUID userId) {
    // UPDATE với condition, atomic operation
    int updated = scheduleRepository.updateAndIncrement(scheduleId);
    // ← Chỉ một query, database handle atomicity
    
    if (updated > 0) {
        // Successfully incremented
        Appointment app = new Appointment(scheduleId, userId);
        return appointmentRepository.save(app);
    } else {
        // Max patients reached
        throw new SlotNotAvailableException();
    }
}

// Repository
@Repository
public interface DoctorScheduleRepository extends JpaRepository<DoctorSchedule, UUID> {
    @Modifying
    @Query("""
        UPDATE DoctorSchedule s 
        SET s.currentPatients = s.currentPatients + 1 
        WHERE s.id = ?1 
          AND s.currentPatients < s.maxPatients
    """)
    int updateAndIncrement(UUID id);
}
```

Cách hoạt động:
- Database chỉ increment nếu condition satisfy
- Atomic — không có intermediate state
- Nếu condition không satisfy, return 0

Lợi:
- **Simplest, most efficient**
- No lock, no retry, no deadlock
- Database native atomicity

Vấn đề:
- Chỉ làm được với simple operations (update, increment)
- Nếu business logic phức tạp (ví dụ: kiểm tra insurance + check schedule + create appointment), không áp dụng được

---

## Chọn giải pháp nào cho HMS

| Scenario | Best solution |
|----------|---------------|
| Simple slot booking (ví dụ: increment counter) | **Atomic UPDATE** |
| Complex logic (check insurance + availability + create) | **Pessimistic lock** (simple, strong guarantee) |
| High contention (100+ users book same slot) | **Optimistic + Circuit Breaker** (reject early, don't retry) |
| Distributed HMS (multiple servers) | **Redis distributed lock** |

Cho HMS của cậu bây giờ: **dùng Atomic UPDATE cho slot booking**.

```java
@Transactional
public BookingResult bookSlot(UUID scheduleId, UUID userId) {
    // Step 1: Atomic increment (no race condition here)
    int updated = scheduleRepository.updateAndIncrement(scheduleId);
    
    if (updated == 0) {
        return new BookingResult(false, "No available slots");
    }
    
    // Step 2: Create appointment (no race condition, slot already reserved)
    try {
        Appointment app = new Appointment(scheduleId, userId);
        appointmentRepository.save(app);
        return new BookingResult(true, "Booked");
    } catch (Exception e) {
        // Rare: slot reserved but insert failed
        // Rollback increment
        scheduleRepository.updateAndDecrement(scheduleId);
        throw e;
    }
}
```

---

## Takeaway

Race conditions không obvious. Cậu không thấy nó khi test locally (vì sequential). Chỉ khi load test hoặc production cậu thấy "2 users book 1 slot" bug.

Nguyên tắc: **mỗi khi read + modify shared resource, cậu cần synchronization**. Chọn cơ chế (lock, version, atomic) dựa vào complexity + performance requirement.

Atomic operation > Optimistic > Pessimistic. Thử từ trên xuống.

---

*Bài tiếp theo: System Design căn bản — System Design là gì và tại sao code giỏi vẫn làm hệ thống sập*
