---
title: "Magic number — bug không có tên nhưng rất khó sửa"
description: "Con số 86400 xuất hiện ở 12 chỗ khác nhau trong codebase. Đó là 12 chỗ có thể sai khi business rule thay đổi — và không ai biết."
category: programming
pubDate: 2024-01-16
series: "Phần 2: Clean Code"
tags: ["clean-code", "magic-numbers", "constants"]
---

Năm ngoái có một codebase thanh toán bị bug production: hệ thống tự động cancel appointment sau 29 phút thay vì 30 phút. Mất gần hai tiếng mới tìm ra nguyên nhân — một con số `30` bị đổi thành `29` ở một chỗ, trong khi còn ba chỗ khác vẫn dùng `30`. Không ai nhớ con số này là gì, từ đâu ra, hay tại sao nó lại xuất hiện bốn lần ở bốn file khác nhau.

Đó là magic number. Và cái bug đó không phải là hiếm.

## Magic number là gì

Magic number là bất kỳ giá trị cứng nào — số, chuỗi, thời gian — xuất hiện trực tiếp trong code mà không có tên, không có giải thích về ý nghĩa của nó.

```java
// ❌ Vấn đề — 30, 3, 100, "PENDING" là magic
if (ChronoUnit.MINUTES.between(appointment.getCreatedAt(), LocalDateTime.now()) > 30) {
    appointment.setStatus(AppointmentStatus.CANCELLED);
}

if (failedAttempts >= 3) {
    accountService.lockAccount(userId);
}

if (queueSize > 100) {
    throw new QueueFullException();
}

appointmentRepository.findByStatus("PENDING");
```

Với mỗi con số này, câu hỏi đặt ra là: 30 phút thì sao? Tại sao 30 mà không phải 15 hay 60? 3 lần thất bại thì lock — quyết định này đến từ đâu? 100 là limit của hệ thống, hay limit của business, hay chỉ là con số bạn đoán?

Người đọc tiếp theo không có câu trả lời. Và nguy hiểm hơn — họ không biết mình không có câu trả lời.

## Hậu quả thực tế

**Sửa một chỗ bỏ sót chỗ khác.** Nếu timeout được define là `30` ở năm chỗ khác nhau và business quyết định đổi thành 45 phút, bạn phải grep toàn bộ codebase và hy vọng không bỏ sót. Và thường thì sẽ bỏ sót.

**Không biết giá trị nào liên quan đến nhau.** `30` trong timeout và `30` trong "max retry attempts" — có phải là cùng một `30` không? Hay chỉ tình cờ giống nhau? Không ai biết.

**Không có context về lý do.** Nếu `3` lần thất bại là rule do security team định, việc dev tùy tiện sửa thành `5` là vi phạm security policy. Nhưng không ai biết điều đó nếu nó chỉ là con số nằm chơi trong code.

## Fix đúng cách: named constant

```java
// ✅ Tốt hơn — constants có tên, có ý nghĩa
public class AppointmentPolicy {
    // Hủy tự động nếu chưa confirm sau X phút
    public static final int UNCONFIRMED_CANCELLATION_TIMEOUT_MINUTES = 30;

    // Số slot tối đa trong queue chờ — giới hạn bởi memory estimate
    public static final int MAX_QUEUE_SIZE = 100;
}

public class SecurityPolicy {
    // Sau X lần thất bại liên tiếp, khóa tài khoản — per security audit Q3
    public static final int MAX_FAILED_LOGIN_ATTEMPTS = 3;
}
```

Bây giờ:

```java
if (minutesSinceCreation > AppointmentPolicy.UNCONFIRMED_CANCELLATION_TIMEOUT_MINUTES) {
    appointment.setStatus(AppointmentStatus.CANCELLED);
}

if (failedAttempts >= SecurityPolicy.MAX_FAILED_LOGIN_ATTEMPTS) {
    accountService.lockAccount(userId);
}
```

Khi business quyết định đổi timeout, bạn sửa một chỗ. Khi security audit yêu cầu review, bạn biết giá trị này đến từ đâu. Khi một dev mới đọc code, họ hiểu ngay `MAX_FAILED_LOGIN_ATTEMPTS` không phải con số ngẫu nhiên.

## Magic string cũng nguy hiểm không kém

Magic number hay được nhắc đến, nhưng magic string thực ra phổ biến hơn và cũng nguy hiểm không kém.

```java
// ❌ Vấn đề — string literal rải rác
appointment.setStatus("PENDING");
if (user.getRole().equals("ROLE_DOCTOR")) { ... }
redisTemplate.opsForValue().set("appointment:lock:" + id, "LOCKED");
```

Mỗi string này nếu thay đổi (rename role, thay đổi status naming convention, thay đổi Redis key format) đều phải tìm và thay toàn bộ codebase. Và typo là hoàn toàn có thể — `"ROLE_DOCTER"` vẫn compile bình thường.

```java
// ✅ Tốt hơn — dùng enum và constant
appointment.setStatus(AppointmentStatus.PENDING); // P02/Bài 05 đã cover
if (user.hasRole(UserRole.DOCTOR)) { ... }

// Key format tập trung một chỗ
public class RedisKeyBuilder {
    private static final String APPOINTMENT_LOCK_PREFIX = "appointment:lock:";

    public static String appointmentLock(Long appointmentId) {
        return APPOINTMENT_LOCK_PREFIX + appointmentId;
    }
}
```

## @ConfigurationProperties cho magic number từ business config

Có một loại magic number đặc biệt: các giá trị mà business có thể cần thay đổi mà không cần deploy lại. Timeout, limit, threshold — những thứ này nên vào `application.yml` thay vì hardcode.

```yaml
# application.yml
appointment:
  unconfirmed-cancellation-timeout-minutes: 30
  max-queue-size: 100

security:
  max-failed-login-attempts: 3
```

```java
// ✅ Tốt hơn — config được inject, không hardcode
@ConfigurationProperties(prefix = "appointment")
public class AppointmentProperties {
    private int unconfirmedCancellationTimeoutMinutes;
    private int maxQueueSize;
    // getters, setters
}
```

Lúc này thay đổi timeout không cần sửa code, không cần redeploy — chỉ cần update config. Cực kỳ quan trọng cho production environment.

## Khi nào magic number là chấp nhận được?

Không phải mọi con số đều cần extract. Một vài trường hợp ổn:

- `0` và `1` trong context rõ ràng (`list.size() == 0`, index đầu tiên)
- Giá trị trong unit test mà context test đã đủ rõ
- Conversion constant đã có tên chuẩn trong domain (`24` giờ/ngày, `60` phút/giờ — nhưng vẫn nên dùng `TimeUnit` thay cho số thô)

Rule of thumb: nếu người đọc có thể hỏi "con số này từ đâu ra?" — nó cần có tên.

## Takeaway

Tìm trong HMS của bạn một chỗ nào đó có số `30`, `60`, `100`, hoặc bất kỳ timeout/limit nào được hardcode trực tiếp. Extract nó ra thành named constant hoặc `@ConfigurationProperties`, và thử viết comment ngắn giải thích tại sao giá trị đó được chọn.

---

*Bài tiếp theo: Đừng nuốt lỗi — hệ thống sẽ trả giá thay bạn*
