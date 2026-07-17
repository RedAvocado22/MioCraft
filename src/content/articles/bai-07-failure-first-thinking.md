---
title: "Tư duy Failure-first — thiết kế để không sập, không phải để chạy"
description: "Hệ thống tốt không phải là hệ thống không bao giờ lỗi — mà là hệ thống lỗi một cách có kiểm soát và tự phục hồi được."
category: programming
pubDate: 2024-01-07
series: "Phần 1: Tư duy lập trình"
tags: ["mindset", "resilience", "failure-first"]
---

Có một điểm khác biệt rất rõ giữa cách tiếp cận vội và cách tiếp cận có hệ thống khi làm một feature mới.

Câu hỏi đầu tiên thường là: *"Làm sao để cái này chạy?"*

Câu hỏi tiếp theo nên là: *"Cái này sẽ fail như thế nào, và khi nó fail, hệ thống sẽ ra sao?"*

Đây không phải pessimism. Đây là **failure-first thinking** — một trong những mindset quan trọng nhất để viết production-ready code.

---

## Mọi thứ đều sẽ fail

Đây không phải câu nói bi quan. Đây là sự thật kỹ thuật.

Trong một distributed system — hay thậm chí chỉ là một ứng dụng web đơn giản với database và một external service — có rất nhiều thứ có thể, và theo thời gian *sẽ*, fail:

- Database connection timeout
- External API (Keycloak, payment gateway) trả về 500
- Memory đầy
- Disk đầy
- Network packet loss
- Race condition giữa concurrent requests
- Config sai ở production
- Deployment không hoàn chỉnh

Câu hỏi không phải là *liệu* những thứ này có xảy ra không. Câu hỏi là *khi* chúng xảy ra, hệ thống của bạn sẽ behave như thế nào.

---

## Failure mode là gì và tại sao nó quan trọng

**Failure mode** là cách một system hoặc component fail — không chỉ là "nó có fail không" mà là "nó fail như thế nào."

Có những failure modes tốt và failure modes tệ.

**Failure mode tốt:** Hệ thống detect được vấn đề, fail rõ ràng với error message có nghĩa, không corrupt data, và cho phép recovery.

**Failure mode tệ:** Hệ thống silently fail, trả về wrong data mà không có error, corrupt state, hoặc cascade fail — một component fail kéo theo toàn bộ hệ thống.

Ví dụ thực tế: trong HMS, khi gọi Keycloak để create user và Keycloak timeout:

```java
// Failure mode tệ — silent fail
try {
    keycloakService.createUser(request);
} catch (Exception e) {
    // Nuốt exception, tiếp tục như không có chuyện gì
    log.warn("Keycloak error: " + e.getMessage());
}
// Code tiếp tục chạy, database record được tạo nhưng không có Keycloak account
// User không login được, nhưng không có error gì được trả về
```

```java
// Failure mode tốt — fail rõ ràng
try {
    keycloakService.createUser(request);
} catch (IdentityProviderException e) {
    // Throw lên, transaction rollback, không có inconsistent state
    throw new ServiceUnavailableException("Identity provider unavailable. Please try again.");
}
```

---

## Fail fast — nguyên tắc nền tảng

**Fail fast** nghĩa là: khi có vấn đề, phát hiện sớm nhất có thể và fail rõ ràng, thay vì để vấn đề lan rộng và manifest thành lỗi khó trace hơn sau đó.

Concrete hơn:

**Validate input ngay khi nhận được**, không phải sau khi process một nửa rồi mới phát hiện invalid. Nếu `doctorId` không tồn tại, throw exception ở đầu method — không phải khi JPA throw `EntityNotFoundException` ở tầng database sau 5 câu query.

**Assert assumptions tường minh.** Nếu một method của bạn assume rằng `appointment.getPatient()` không bao giờ null, hãy assert điều đó explicitly:

```java
Objects.requireNonNull(appointment.getPatient(), 
    "Appointment must have a patient before processing payment");
```

**Không nuốt exception.** Catch exception chỉ khi bạn thực sự có plan để handle nó — log và rethrow, convert sang domain exception, hoặc có fallback logic thật sự. Catch và bỏ qua là recipe cho silent corruption.

---

## Designing for failure — cụ thể hơn

Failure-first thinking không chỉ là "handle exception cho đúng." Nó ảnh hưởng đến cách bạn thiết kế toàn bộ flow.

**Timeout mọi external call.** Không có default timeout nghĩa là một external service treo có thể giữ thread của bạn mãi mãi. Với Spring Boot và RestTemplate/WebClient, luôn configure explicit timeout.

**Idempotency cho write operations.** Khi client retry (và họ sẽ retry), hệ thống có xử lý đúng không? Payment không được process hai lần. Appointment không được book hai lần. Idempotency key là cách đơn giản nhất để handle điều này.

**Circuit breaker cho external dependencies.** Nếu Keycloak đang down, tiếp tục gọi nó 1000 lần/giây không giúp nó recover nhanh hơn — nó chỉ làm thread pool của bạn cạn kiệt. Circuit breaker detect khi một dependency đang fail và stop gọi nó tạm thời, cho cả hệ thống và dependency đó thời gian recover.

**Graceful degradation.** Khi một component không critical fail, hệ thống có thể tiếp tục hoạt động với reduced functionality không? Ví dụ: nếu notification service down, appointment booking vẫn thành công — user chỉ không nhận được email. Đó tốt hơn là booking fail hoàn toàn vì email service down.

---

## Observability — biết khi nào mình đang fail

Failure-first thinking cũng bao gồm việc đảm bảo bạn *biết* khi nào system đang fail.

Một system fail trong silence còn tệ hơn một system fail rõ ràng — vì bạn không biết để fix.

Log đủ để answer câu hỏi: *"Chuyện gì đã xảy ra ngay trước khi system fail?"* Không phải log mọi thứ (đó là noise), nhưng log những decision points quan trọng, những external calls, và tất cả những unexpected states.

---

## Takeaway

Lần tới khi bạn implement một feature, sau khi code happy path xong, hãy dừng lại và hỏi: *"Cái này fail như thế nào? Và khi nó fail, system của mình ở trạng thái gì?"*

Nếu câu trả lời là "mình không biết" hoặc "mình chưa nghĩ tới" — đó là phần bạn cần implement tiếp, không phải coi feature đó là done.

Done không phải là "happy path chạy được." Done là "happy path chạy được, và known failure cases được handle rõ ràng."

---

*Bài tiếp theo: Tư duy Trade-off — không có giải pháp hoàn hảo, chỉ có lựa chọn phù hợp.*
