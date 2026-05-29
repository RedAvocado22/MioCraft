---
title: "Notification preferences — opt-out, unsubscribe, không spam người đã tắt"
description: "User tắt email marketing vẫn nhận reminder — check preference trước send, link unsubscribe one-click, audit log."
category: system-design
pubDate: 2026-06-04
series: "Phần 10: Case Studies thực tế"
tags: ["case-study", "notification", "email", "compliance"]
---

Bệnh nhân bấm “Tắt email nhắc lịch” trong settings. Tuần sau vẫn nhận “Nhắc khám ngày mai”. Ticket support: *“Hệ thống không tôn trọng lựa chọn.”* Dev trace: `AppointmentReminderJob` gọi thẳng `mailSender.send()` — **không đọc** bảng preference.

Gửi notification sau commit (bài 85) chỉ đảm bảo email khớp data — không đảm bảo **được phép gửi**.

---

## Phân loại channel và loại tin

Không phải mọi email đều opt-out được như nhau:

| Loại | Ví dụ | Opt-out |
|------|--------|---------|
| **Transactional** | Xác nhận đặt lịch, reset password | Thường bắt buộc — không tắt hết nếu vẫn dùng dịch vụ |
| **Reminder** | Nhắc khám 24h trước | User chọn tắt — nhưng có thể bật SMS thay email |
| **Marketing** | Khuyến mãi gói khám | Phải opt-in hoặc unsubscribe rõ |

Model đơn giản:

```java
@Entity
public class NotificationPreference {
  @Id
  private UUID userId;

  private boolean emailAppointmentReminder = true;
  private boolean emailMarketing = false;
  private boolean smsAppointmentReminder = true;
  private Instant updatedAt;
}
```

Check **trước mọi send** — một chỗ, không rải `if` trong từng job.

---

## Gate tập trung — không gửi nếu đã tắt

```java
@Service
@RequiredArgsConstructor
public class NotificationDispatchService {

  private final NotificationPreferenceRepository prefs;
  private final MailSender mailSender;

  public void sendReminder(Appointment appointment, NotificationType type) {
    UUID userId = appointment.getPatient().getUserId();
    NotificationPreference p = prefs.findById(userId)
        .orElse(NotificationPreference.defaults());

    if (type == NotificationType.APPOINTMENT_REMINDER_EMAIL
        && !p.isEmailAppointmentReminder()) {
      log.info("Skip email reminder userId={} appointmentId={}", userId, appointment.getId());
      return; // không gọi SMTP
    }

    mailSender.send(buildReminder(appointment));
  }
}
```

Job cron và event listener (bài 85) đều đi qua service này — không bypass.

---

## Unsubscribe link — không chỉ UI settings

Email reminder/marketing nên có link **one-click** (header `List-Unsubscribe` + URL token). User không cần login vẫn tắt được — giảm complaint và đúng kỳ vọng provider email.

```java
// Token signed, expiry, map userId + channel
@GetMapping("/api/public/notifications/unsubscribe")
public ResponseEntity<Void> unsubscribe(@RequestParam String token) {
  UnsubscribeClaims claims = tokenService.verify(token);
  preferenceService.disable(claims.userId(), claims.channel());
  return ResponseEntity.noContent().build();
}
```

Token one-time hoặc HMAC có expiry — đừng chỉ `?userId=uuid` plain text (lộ + spoof).

---

## Đừng nhầm “tắt email” với “tắt mọi thứ”

User tắt email reminder nhưng bật SMS — job phải đọc từng flag. Audit log khi preference đổi (`who`, `when`, `old/new`) giúp debug “ai tắt giúp tôi”.

---

## Takeaway

Trước khi thêm `sendXxx()` mới: nó đi qua `NotificationDispatchService` chưa? Preference có channel + loại tin tương ứng chưa? Email không transactional cần unsubscribe hoạt động được từ link trong mail.

---

*Bài tiếp theo: Doctor double-booking — edge case ở tầng DB*
