---
title: "Khi nào comment là dấu hiệu code đang có vấn đề"
description: "Comment không phải lúc nào cũng tốt. Khi bạn cần comment để giải thích code — thường đó là dấu hiệu code cần được viết lại."
category: programming
pubDate: 2024-01-14
series: "Phần 2: Clean Code"
tags: ["clean-code", "comments", "readability"]
---

Có một câu hỏi mà dev mới hay hỏi: "Code của mình có cần comment không?" Câu trả lời đúng không phải là có hoặc không — mà là: *nó phụ thuộc vào lý do bạn muốn viết comment đó.*

Vì có những comment là gold. Và có những comment là dấu hiệu bạn đang cố che giấu code xấu bằng chữ.

## Comment tệ nhất: giải thích code làm gì

```java
// Lấy danh sách appointment theo doctorId và status PENDING
List<Appointment> appointments = appointmentRepository
    .findByDoctorIdAndStatus(doctorId, AppointmentStatus.PENDING);

// Tính tổng số appointment
int total = appointments.size();

// Trả về kết quả
return total;
```

Ba comment này là noise thuần túy. Chúng không thêm thông tin gì — code đã nói điều đó rồi. Tệ hơn: khi code thay đổi mà comment không được update, comment trở thành misleading.

**Nguyên tắc:** Nếu comment chỉ paraphrase lại code bằng tiếng Anh — xóa nó đi.

## Comment tệ thứ hai: patch cho tên xấu

```java
// d: số ngày từ lần khám cuối
int d = calculateDaysSinceLastVisit(patientId);

// Check nếu hết hạn
if (d > 365) { ... }
```

Hai comment này tồn tại vì `d` và `hết hạn` không đủ rõ. Solution đúng không phải là comment — là đổi tên.

```java
int daysSinceLastVisit = calculateDaysSinceLastVisit(patientId);

if (daysSinceLastVisit > ANNUAL_CHECKUP_INTERVAL_DAYS) { ... }
```

Không cần comment nữa. Code tự giải thích.

Đây là rule quan trọng: **Comment không nên là cái nạng đỡ cho code không đứng vững được.** Nếu bạn cảm thấy cần comment để giải thích một tên biến hoặc một function — đó là signal để refactor, không phải để viết comment.

## Comment tốt nhất: giải thích tại sao, không phải là gì

```java
// Dùng setIfAbsent thay vì check-then-set vì Redis không guarantee atomicity
// giữa hai lệnh riêng lẻ — race condition sẽ xảy ra dưới load cao
Boolean locked = redisTemplate.opsForValue()
    .setIfAbsent(slotKey, "BOOKED", SLOT_LOCK_TTL_MINUTES, TimeUnit.MINUTES);
```

Comment này không giải thích code làm gì — code đã rõ. Nó giải thích *tại sao* lại chọn cách này thay vì cách khác, và *điều gì sẽ xảy ra* nếu không làm vậy.

Đây là loại comment cực kỳ có giá trị. Người đọc tiếp theo sẽ không "optimize" nó thành check-then-set rồi tạo ra bug production.

Thêm một ví dụ:

```java
// Cố tình không index cột notes — query theo notes không bao giờ xảy ra trong business
// và full-text search sau này sẽ dùng Elasticsearch, không phải LIKE query
@Column(name = "notes", columnDefinition = "TEXT")
private String notes;
```

Không có comment này, dev sau sẽ thấy "sao không có index nhỉ" và thêm vào một cách vô tư — tạo ra index không cần thiết, tốn memory, làm chậm write.

## Comment tốt thứ hai: document constraint bên ngoài

```java
// Keycloak yêu cầu role name phải là chữ thường, không dấu cách
// Ref: https://www.keycloak.org/docs/... (internal docs)
// Nếu sửa pattern này cần update cả Keycloak realm config
private static final String ROLE_NAME_PATTERN = "^[a-z][a-z0-9_-]*$";
```

Code không thể giải thích context bên ngoài hệ thống. Comment làm điều đó.

Tương tự với workaround cho bug của thư viện third-party:

```java
// Workaround cho bug trong Spring Data JPA khi dùng @EntityGraph với pagination
// Issue: https://github.com/spring-projects/spring-data-jpa/issues/xxxxx
// Có thể remove sau khi upgrade lên Spring Boot 3.x.x
@Query("SELECT DISTINCT a FROM Appointment a LEFT JOIN FETCH a.doctor WHERE ...")
Page<Appointment> findWithDoctorInfo(Pageable pageable);
```

## Comment tốt thứ ba: TODO và FIXME có context

```java
// TODO: [P10/Bài 01] Hiện tại dùng pessimistic lock — cần migrate sang Redis Lua
// khi traffic tăng lên. Estimate: cần refactor toàn bộ SlotBookingService
// TODO: Deadline: trước khi deploy production tháng 6
@Lock(LockModeType.PESSIMISTIC_WRITE)
Optional<AppointmentSlot> findByDoctorIdAndDateAndTimeSlot(...);
```

TODO không có context là rác. TODO có context — lý do tại sao chưa fix, plan là gì, deadline là bao giờ — là documentation hữu ích.

## Comment JavaDoc: biết khi nào cần

JavaDoc có giá trị cho public API — tức là code mà người khác sẽ gọi mà không nhìn vào implementation.

```java
/**
 * Tính phần bệnh nhân phải trả sau khi trừ bảo hiểm.
 *
 * <p>Nếu bệnh nhân không có bảo hiểm hoặc bảo hiểm hết hạn,
 * trả về toàn bộ totalFee.
 *
 * @param appointment appointment đã có totalFee được set
 * @throws InsuranceServiceException nếu insurance service không phản hồi
 */
public BigDecimal calculatePatientPaymentShare(Appointment appointment) { ... }
```

Nhưng với private method trong internal service — không cần JavaDoc. Code rõ là đủ.

## Tóm lại: comment hay hay dở?

| Loại comment | Đánh giá |
|---|---|
| Giải thích code làm gì (paraphrase) | ❌ Xóa đi |
| Bù đắp cho tên xấu | ❌ Đổi tên thay |
| Giải thích tại sao chọn cách này | ✅ Giữ lại |
| Document constraint bên ngoài | ✅ Cần thiết |
| Workaround cho bug third-party | ✅ Cần thiết |
| TODO có context và plan | ✅ Hữu ích |
| TODO không có context | ❌ Noise |
| JavaDoc cho public API | ✅ Cần thiết |

## Takeaway

Lần tới bạn định viết comment, dừng lại một giây và hỏi: "Mình viết comment này vì code chưa đủ rõ, hay vì có thông tin thật sự mà code không thể nói được?" Nếu là cái trước — refactor trước, comment sau.

---

*Bài tiếp theo: Boolean flag — kẻ phá hoại thầm lặng*
