---
title: "Builder — object phức tạp không cần constructor 12 tham số"
description: "GoF gặp vấn đề với object có quá nhiều optional field. Builder tách quá trình tạo object thành từng bước. Lombok @Builder thì sao?"
category: programming
pubDate: 2026-07-12
series: "Phần 5: Design Patterns"
tags: ["builder", "design-pattern", "lombok", "java"]
---

HMS có class `Appointment`. Ngoài `patientId`, `doctorId`, và `scheduledAt` là mandatory, còn có `notes`, `referralCode`, `insuranceClaimId`, `followUpFromId`, `priorityLevel`, `roomPreference`... Một số field cần nhau theo từng use case khác nhau.

Bạn viết constructor. Sau khi thêm field thứ 5, constructor trông như thế này:

```java
// ❌ Telescoping constructor — kinh điển
Appointment apt = new Appointment(
    patientId,
    doctorId,
    scheduledAt,
    null,   // notes — không có
    null,   // referralCode — không có
    "INS-789",  // insuranceClaimId
    null,   // followUpFromId
    Priority.NORMAL,
    null    // roomPreference
);
```

Caller phải đếm position. `null` thứ ba là gì? Không biết nếu không mở class ra nhìn. Thêm một field mới vào giữa thì mọi chỗ gọi constructor này đều bị break.

---

## GoF gặp bài toán gì

Đây là "telescoping constructor" problem — đặt tên bởi Joshua Bloch trong *Effective Java*. GoF gọi cái giải pháp của họ là Builder: **tách quá trình tạo một object phức tạp thành các bước riêng biệt, cho phép tạo những biểu diễn khác nhau của cùng một loại object từ cùng một process.**

Định nghĩa nghe có vẻ phức tạp, nhưng ý tưởng đơn giản: thay vì nhét tất cả vào constructor, bạn build từng bước, và cuối cùng gọi `.build()` để tạo object thật.

---

## Builder thủ công trông thế nào

```java
public class Appointment {
    // Fields
    private final UUID patientId;       // required
    private final UUID doctorId;        // required
    private final LocalDateTime scheduledAt; // required
    private final String notes;         // optional
    private final String referralCode;  // optional
    private final String insuranceClaimId; // optional
    private final Priority priorityLevel;  // optional, default NORMAL

    // Private constructor — chỉ Builder mới được gọi
    private Appointment(Builder builder) {
        this.patientId       = builder.patientId;
        this.doctorId        = builder.doctorId;
        this.scheduledAt     = builder.scheduledAt;
        this.notes           = builder.notes;
        this.referralCode    = builder.referralCode;
        this.insuranceClaimId = builder.insuranceClaimId;
        this.priorityLevel   = builder.priorityLevel;
    }

    // Static nested Builder class
    public static class Builder {
        // Required fields — set qua constructor của Builder
        private final UUID patientId;
        private final UUID doctorId;
        private final LocalDateTime scheduledAt;

        // Optional fields — default value
        private String notes;
        private String referralCode;
        private String insuranceClaimId;
        private Priority priorityLevel = Priority.NORMAL;

        public Builder(UUID patientId, UUID doctorId, LocalDateTime scheduledAt) {
            this.patientId   = patientId;
            this.doctorId    = doctorId;
            this.scheduledAt = scheduledAt;
        }

        public Builder notes(String notes) {
            this.notes = notes;
            return this;
        }

        public Builder referralCode(String referralCode) {
            this.referralCode = referralCode;
            return this;
        }

        public Builder insuranceClaimId(String id) {
            this.insuranceClaimId = id;
            return this;
        }

        public Builder priorityLevel(Priority priority) {
            this.priorityLevel = priority;
            return this;
        }

        public Appointment build() {
            // Validate required fields hoặc business rule tại đây
            Objects.requireNonNull(patientId, "patientId is required");
            Objects.requireNonNull(doctorId,  "doctorId is required");
            Objects.requireNonNull(scheduledAt, "scheduledAt is required");
            return new Appointment(this);
        }
    }
}
```

Gọi:

```java
// ✅ Rõ ràng từng field
Appointment apt = new Appointment.Builder(patientId, doctorId, scheduledAt)
    .insuranceClaimId("INS-789")
    .priorityLevel(Priority.HIGH)
    .build();
```

Bạn đọc code này mà không cần mở class `Appointment` vẫn biết đang set gì. Thêm field mới vào Builder không break caller cũ.

---

## Lombok @Builder: 99% trường hợp bạn nên dùng cái này

Viết tay Builder cho mọi class là boilerplate không cần thiết. Lombok có `@Builder`:

```java
@Builder
@Getter
public class Appointment {
    // Required fields không có giá trị default
    private final UUID patientId;
    private final UUID doctorId;
    private final LocalDateTime scheduledAt;

    // Optional với default
    @Builder.Default
    private final Priority priorityLevel = Priority.NORMAL;

    private final String notes;
    private final String referralCode;
    private final String insuranceClaimId;
}
```

Lombok tự generate toàn bộ Builder class. Cú pháp gọi y hệt:

```java
Appointment apt = Appointment.builder()
    .patientId(patientId)
    .doctorId(doctorId)
    .scheduledAt(scheduledAt)
    .insuranceClaimId("INS-789")
    .priorityLevel(Priority.HIGH)
    .build();
```

`@Builder.Default` là quan trọng — nếu không có nó, field có default value (`Priority.NORMAL`) sẽ bị set về `null` khi dùng Builder, vì Lombok generated code không gọi field initializer.

---

## Một biến thể quan trọng: Builder để tạo Request object

Trong HMS, Builder không chỉ dùng cho entity. Một ứng dụng phổ biến là DTO/Request object được tạo ở nhiều chỗ với nhiều combination khác nhau — đặc biệt trong test:

```java
// Trong test — Builder giúp tạo fixture rõ ràng
@Test
void shouldSendHighPriorityNotification() {
    Appointment apt = Appointment.builder()
        .patientId(UUID.randomUUID())
        .doctorId(UUID.randomUUID())
        .scheduledAt(LocalDateTime.now().plusDays(1))
        .priorityLevel(Priority.HIGH)
        .build();

    // ... assert notification được gửi ngay
}
```

So với việc tạo constructor 9 tham số rồi điền `null` cho những field không cần trong test — Builder làm test dễ đọc hơn nhiều.

---

## Khi nào Builder quá tay

Builder thêm complexity. Với object đơn giản chỉ có 2–3 field, tất cả required, constructor thường là đủ:

```java
// ✅ Constructor đủ dùng — đơn giản và rõ
public SmsRequest(String recipient, String message) {
    this.recipient = recipient;
    this.message   = message;
}
```

Builder cho `SmsRequest` hai field là over-engineering. Nguyên tắc đơn giản: **khi bạn bắt đầu thấy mình điền `null` vào constructor, hoặc khi bạn tạo nhiều constructor overload, đó là lúc cần Builder**.

Cũng đừng dùng Builder khi object cần validation phức tạp giữa nhiều field với nhau. `.build()` method có thể chứa một số validation, nhưng nếu rule phức tạp, Factory Method hoặc static factory method thường đọc rõ hơn.

---

## Takeaway

Builder giải bài "constructor quá nhiều tham số" và "optional field làm caller phải điền null liên tục". Lombok `@Builder` là đủ cho 99% trường hợp trong Spring Boot — không cần viết tay. Nhớ thêm `@Builder.Default` cho field có giá trị mặc định, hoặc bạn sẽ debug `NullPointerException` không rõ lý do.

---

*Bài tiếp theo: Adapter — khi hai interface không nói chuyện được với nhau*
