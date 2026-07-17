---
title: "Cache không phải lúc nào cũng làm hệ thống nhanh hơn"
description: "Cache thêm complexity, tăng memory usage, và tạo ra stale data problems. Nếu cache hit rate thấp — bạn đang trả chi phí của cache mà không nhận được lợi ích."
category: system-design
pubDate: 2024-03-18
series: "Phần 9: Không phải lúc nào cũng đúng"
tags: ["tech-myths", "caching", "performance"]
---

Có một phản xạ rất phổ biến: hệ thống chậm → thêm cache. Nó đến tự nhiên đến mức nhiều dev không dừng lại để hỏi tại sao hệ thống chậm trước khi nhảy vào implement Redis.

Đôi khi cache giải quyết được. Đôi khi nó che giấu vấn đề thật sự. Và đôi khi nó tạo ra bug mới đau hơn cái chậm ban đầu.

---

## Cache chỉ giải quyết một loại vấn đề

Cache hiệu quả khi và chỉ khi:

1. **Data đọc nhiều hơn viết** — nếu mỗi giây data thay đổi một lần và cũng được đọc một lần thì cache không giúp được gì
2. **Recompute cost cao hơn storage cost** — nếu query mất 200ms, cache giúp. Nếu query mất 2ms thì thêm Redis overhead có khi còn chậm hơn
3. **Stale data chấp nhận được** — không phải lúc nào cũng vậy

Trong HMS, có những thứ cache được và có những thứ không. Doctor's profile (name, specialization) → cache được thoải mái, ít thay đổi. Available slots của một doctor hôm nay → phải nghĩ kỹ, vì nó thay đổi mỗi khi có booking mới.

---

## Khi cache trở thành nguồn gốc của bug

Đây là một tình huống thực: `DoctorScheduleService` cache danh sách available slots với TTL 5 phút.

```java
public List<SlotResponse> getAvailableSlots(UUID doctorId, LocalDate date) {
    String cacheKey = "slots:" + doctorId + ":" + date;
    
    List<SlotResponse> cached = redisTemplate.opsForValue().get(cacheKey);
    if (cached != null) return cached;
    
    List<SlotResponse> slots = scheduleRepository
        .findAvailableSlots(doctorId, date)
        .stream()
        .map(slotMapper::toResponse)
        .toList();
    
    redisTemplate.opsForValue().set(cacheKey, slots, Duration.ofMinutes(5));
    return slots;
}
```

Có vẻ ổn. Nhưng khi một bệnh nhân book slot 9:00 AM thành công, user khác trong vòng 5 phút tiếp theo vẫn thấy slot đó available — vì cache chưa expire. Họ bấm book, đến step cuối mới nhận ra slot đã hết.

Vấn đề không phải là code cache sai — code đúng. Vấn đề là **cache strategy không phù hợp với tính chất của data.** Slot availability thay đổi real-time theo từng booking, nên TTL-based cache là sai tool ngay từ đầu.

Giải pháp đúng cho HMS là invalidate cache ngay khi booking xảy ra:

```java
// AppointmentService.java
@Transactional
public AppointmentResponse bookAppointment(BookingRequest request) {
    // ... booking logic
    
    // Invalidate ngay lập tức thay vì đợi TTL expire
    String cacheKey = "slots:" + request.getDoctorId() + ":" + request.getDate();
    redisTemplate.delete(cacheKey);
    
    return response;
}
```

Hoặc tốt hơn nữa — với slot availability, đừng cache bằng Redis value. Dùng Redis để làm atomic reservation lock (như HMS đã làm với Lua script) và bỏ qua cache layer hoàn toàn cho data này.

---

## Khi cache che giấu vấn đề thật sự

Nếu query của bạn chậm vì thiếu index, cache sẽ che điều đó đi hoàn toàn — cho đến khi cache miss đồng loạt xảy ra (cache stampede, đã có một bài riêng), hoặc khi bạn cần một query variation mới mà không thể cache.

Một query như thế này trong HMS:

```java
// ❌ Query không có index trên doctor_id và date — chậm
List<DoctorSchedule> schedules = entityManager
    .createQuery("SELECT s FROM DoctorSchedule s WHERE s.doctor.id = :doctorId AND s.date = :date")
    .setParameter("doctorId", doctorId)
    .setParameter("date", date)
    .getResultList();
```

Thêm cache vào đây không giải quyết vấn đề. Nó ẩn vấn đề. Khi có cache miss (cache khởi động lại, key expire) — query chậm bùng phát trở lại.

Fix đúng là thêm composite index `(doctor_id, date)` vào bảng. Cache là layer thứ hai, không phải layer thứ nhất.

---

## Cache làm tăng complexity của hệ thống

Mỗi lần thêm cache, bạn thêm vào hệ thống:

- Một data store thứ hai cần operate và monitor
- Một class of bug mới: stale data, cache poisoning, inconsistency giữa cache và DB
- Invalidation logic phải đúng ở mọi nơi data thay đổi — nếu có 3 chỗ update `DoctorSchedule` mà bạn chỉ invalidate 2 chỗ, cache sẽ lie với bạn

Đó không phải lý do để không dùng cache. Đó là lý do để chỉ dùng cache khi bạn đã hiểu rõ vấn đề cần giải quyết.

---

## Takeaway

Trước khi thêm cache, hỏi: *"Database query của mình chậm vì thiếu index, vì đang load data thừa, hay vì genuinely cần nhiều compute?"* Nếu là hai cái đầu, fix đó trước. Cache chỉ có ý nghĩa khi query đã optimal rồi mà vẫn cần giảm thêm latency hoặc database load.

---

*Bài tiếp theo: DRY không phải lúc nào cũng là best practice*
