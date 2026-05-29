---
title: "Timezone và slot lịch hẹn — 9h sáng không lệch ngày"
description: "LocalDateTime không có timezone. API contract: Instant + ZoneId, lưu UTC, hiển thị theo clinic. Bug lịch hẹn ngày 15 thành 14."
category: system-design
pubDate: 2026-06-05
series: "Phần 10: Case Studies thực tế"
tags: ["case-study", "timezone", "appointment", "api-design"]
---


Bệnh nhân ở TP.HCM chọn slot **9:00 sáng thứ Hai 15/6**. Xác nhận email hiện **8:00**. Hoặc tệ hơn: DB ghi `2025-06-14 17:00:00` — đúng UTC nhưng team đọc nhầm là local, báo cáo ngày **14**.

Server `TZ=UTC`. Developer test local `Asia/Ho_Chi_Minh`. `LocalDateTime` không mang timezone — mọi người **tưởng** cùng hiểu "9h" nhưng không.

Timezone bug không crash. Nó **lệch lịch khám** — loại production bug tệ nhất với HMS.

---

## Đừng lưu LocalDateTime cho moment có timezone

```java
// ❌ Không biết 9:00 là giờ nào trên Trái Đất
@Entity
public class Appointment {
  private LocalDateTime scheduledAt;
}
```

`LocalDateTime` = "đồng hồ treo tường" không ghi múi giờ. Phù hợp sinh nhật (ngày sinh không đổi theo TZ). **Không** phù hợp "9h sáng tại phòng khám HCM".

---

## Lưu Instant (UTC), hiển thị theo ZoneId phòng khám

```java
@Entity
public class Appointment {
  private Instant scheduledAt;           // absolute moment
  private String clinicZoneId;             // "Asia/Ho_Chi_Minh" — hoặc FK Clinic
}

@Entity
public class Clinic {
  private String zoneId; // mỗi cơ sở có thể khác (hiếm VN nhưng cần model đúng)
}
```

API nhận từ frontend — rõ ràng:

```java
public record BookAppointmentRequest(
    UUID scheduleId,
    LocalDate date,           // ngày theo lịch phòng khám
    LocalTime startTime,      // giờ theo lịch phòng khám
    String clinicZoneId       // hoặc server derive từ schedule
) {}
```

Convert **một chỗ** trong service:

```java
ZoneId zone = ZoneId.of(request.clinicZoneId());
ZonedDateTime zdt = ZonedDateTime.of(request.date(), request.startTime(), zone);
Instant instant = zdt.toInstant();
appointment.setScheduledAt(instant);
```

Response trả về cho UI:

```java
public record AppointmentResponse(
    UUID id,
    Instant scheduledAt,
    String displayZoneId,
    String scheduledAtLocal // "2025-06-15T09:00" pre-formatted hoặc để client format
) {
  public static AppointmentResponse from(Appointment apt, ZoneId zone) {
    var zdt = apt.getScheduledAt().atZone(zone);
    return new AppointmentResponse(
        apt.getId(),
        apt.getScheduledAt(),
        zone.getId(),
        zdt.format(DateTimeFormatter.ISO_LOCAL_DATE_TIME)
    );
  }
}
```

---

## DoctorSchedule theo ngày local

Slot "thứ Hai 15/6" là **ngày lịch phòng khám**, không phải UTC date:

```java
@Entity
public class DoctorSchedule {
  private LocalDate scheduleDate;  // OK — business date tại clinic
  private LocalTime startTime;
  private LocalTime endTime;
  private String clinicZoneId;
}
```

Khi check conflict với `Instant` appointment — convert về cùng `ZoneId` trước khi so.

---

## MySQL và JDBC

`Instant` → `TIMESTAMP` — driver và `serverTimezone` phải nhất quán. Khuyến nghị: lưu UTC (`Instant`), `connectionTimeZone=UTC`, format ở application.

Đừng `SET time_zone = '+07:00'` trên connection pool lẫn lộn.

---

## Test bắt buộc

```java
@Test
void bookingAtNineAmHcmStoredAsCorrectInstant() {
  var req = new BookAppointmentRequest(scheduleId, LocalDate.of(2025, 6, 15),
      LocalTime.of(9, 0), "Asia/Ho_Chi_Minh");
  var apt = service.book(req);
  assertEquals(
      ZonedDateTime.of(2025, 6, 15, 9, 0, 0, 0, ZoneId.of("Asia/Ho_Chi_Minh")).toInstant(),
      apt.getScheduledAt()
  );
}
```

Test qua **ngày đổi DST** nếu clinic ngoài VN — VN không DST nhưng pattern vẫn đúng.

---

## Takeaway

Moment "9h tại phòng khám" = `ZonedDateTime` → `Instant` lưu DB. API document zone. Không `LocalDateTime` cho appointment time. Và khi email nhắc lịch sai giờ — grep `LocalDateTime` trước khi blame SMTP.

---

*Bài tiếp theo: Graceful shutdown và readiness probe.*
