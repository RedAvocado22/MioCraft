---
title: "Cron job — ShedLock khi hai instance cùng chạy scheduled task"
description: "@Scheduled trên hai pod Spring = email nhắc lịch gửi đôi. Distributed lock Redis/DB — chỉ một instance chạy job mỗi lần."
category: programming
pubDate: 2026-06-04
series: "Phần 12: Production & Ops"
tags: ["production", "scheduled", "shedlock", "redis"]
---


8h sáng cron `sendAppointmentReminders()` chạy. HMS deploy **2 instance** sau load balancer. Cả hai pod đều có `@Scheduled(cron = "0 0 8 * * *")`.

Bệnh nhân nhận **hai SMS** "Nhắc lịch mai 9h". Support inbox nổ. Log hai dòng `Sent reminder for appointmentId=...` cách nhau vài trăm ms — cùng một ID.

Horizontal scale phá assumption "chỉ có một server".

---

## @Scheduled không biết cluster

Spring `@Scheduled` chạy **trên mỗi JVM** nơi bean tồn tại. Scale replica = nhân số lần chạy. Không bug — đúng thiết kế mặc định.

Fix: **distributed lock** — chỉ một instance acquire lock rồi chạy job.

---

## ShedLock — pattern phổ biến

Dependency `shedlock-spring` + provider Redis hoặc JDBC.

```java
@Configuration
@EnableScheduling
@EnableSchedulerLock(defaultLockAtMostFor = "PT30M")
public class SchedulingConfig {}
```

```java
@Component
public class AppointmentReminderJob {

  private final AppointmentReminderService reminderService;

  @Scheduled(cron = "${hms.reminder.cron:0 0 8 * * *}", zone = "Asia/Ho_Chi_Minh")
  @SchedulerLock(
      name = "appointmentReminder",
      lockAtLeastFor = "PT1M",
      lockAtMostFor = "PT30M"
  )
  public void sendTomorrowReminders() {
    reminderService.sendForDate(LocalDate.now().plusDays(1));
  }
}
```

Bảng `shedlock` (hoặc Redis key):

| name | lock_until | locked_at | locked_by |
|------|------------|-----------|-----------|
| appointmentReminder | ... | ... | pod-2 |

Instance khác thấy lock còn hiệu lực → **skip** lần chạy đó.

`lockAtLeastFor` — tránh flip-flop khi job quá ngắn. `lockAtMostFor` — pod chết giữ lock, lock hết hạn để instance khác takeover.

---

## Job phải idempotent dù đã có lock

Lock giảm duplicate; không đảm bảo 100% (clock skew, DB glitch). Gửi SMS vẫn nên check `reminder_sent_at IS NULL` trước khi gửi, update sau khi gửi — trong transaction.

```java
@Transactional
public void sendReminder(Appointment apt) {
  if (apt.isReminderSent()) return;
  smsService.send(apt.getPatientPhone(), buildMessage(apt));
  apt.markReminderSent();
  appointmentRepository.save(apt);
}
```

---

## Timezone trên cron

`zone = "Asia/Ho_Chi_Minh"` — server UTC mà cron không zone → nhắc lịch lệch 7 tiếng. Nối bài 118.

---

## Outbox worker cũng cần lock

`@Scheduled` process outbox (bài 115) trên N instance — cùng vấn đề. Một lock name `outboxProcessor` hoặc `SELECT ... FOR UPDATE SKIP LOCKED` trên outbox rows.

---

## Khi nào không dùng @Scheduled

Job nặng, cần dashboard retry: đưa sang **queue consumer** (Rabbit) với single consumer group hoặc partition. Cron chỉ trigger "enqueue batch" với lock.

---

## Takeaway

Deploy từ 1 → 2 instance: rà soát mọi `@Scheduled`. Thêm ShedLock (hoặc tương đương) + idempotent business logic. Và set `zone` trên cron — 8h sáng VN là 8h VN, không phải 8h UTC.

---

*Bài tiếp theo: Timezone và slot lịch hẹn — 9h sáng không lệch ngày.*
