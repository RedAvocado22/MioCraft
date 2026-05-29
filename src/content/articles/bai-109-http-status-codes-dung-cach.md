---
title: "HTTP status codes đúng cách — tại sao return 200 cho mọi thứ là sai"
description: "4xx là lỗi client, 5xx là lỗi server. 201 Created vs 200 OK. API trả 200 kèm success:false khiến monitoring và client đều mù."
category: system-design
pubDate: 2026-05-27
series: "Phần 8: System Design"
tags: ["API", "HTTP", "REST", "system-design"]
---


Có một pattern mà frontend dev ghét nhất: mọi response đều HTTP 200, body là:

```json
{ "success": false, "errorCode": "APPOINTMENT_NOT_FOUND", "message": "..." }
```

Monitoring dashboard xanh vì chỉ đếm status 200. Load balancer nghĩ server healthy. Client phải parse JSON mới biết fail — và quên một chỗ là bug production.

Backend team bảo: *"Đỡ phải handle nhiều status code."* Thực ra họ chuyển complexity sang mọi consumer và làm hệ thống **không quan sát được** bằng tool chuẩn.

HTTP status code tồn tại vì **ngữ nghĩa của outcome** nên nằm ở protocol layer, không chỉ trong body.

---

## Nhóm status — ai chịu trách nhiệm?

| Nhóm | Ý nghĩa | Ai sửa? | Ví dụ HMS |
|------|---------|--------|-----------|
| 2xx | Thành công | — | Tạo appointment, GET patient |
| 4xx | Client gửi sai / không có quyền | Frontend, caller | UUID sai, hết slot, thiếu JWT |
| 5xx | Server lỗi | Backend, ops | DB down, bug NullPointer |

**4xx** — request có thể hợp lệ về mặt HTTP nhưng **không được xử lý** vì business hoặc auth: 404 không tìm thấy appointment, 409 conflict slot đã full, 403 patient xem hồ sơ người khác.

**5xx** — server **mong đợi** xử lý được nhưng fail: connection pool exhausted, unhandled exception. Client **có thể retry** (với idempotency) — 500, 502, 503.

Nhầm 404 thành 500: frontend retry vô ích, alert on-call 3 giờ sáng cho lỗi user gõ sai ID.

Nhầm 500 thành 400: client không retry khi nên retry, che giấu bug server.

---

## 200 vs 201 vs 204

```java
@PostMapping("/appointments")
public ResponseEntity<AppointmentResponse> create(@Valid @RequestBody CreateAppointmentRequest request) {
  var created = appointmentService.book(request);
  return ResponseEntity
      .status(HttpStatus.CREATED)  // 201
      .location(URI.create("/api/appointments/" + created.id()))
      .body(created);
}
```

**201 Created** — resource mới tồn tại. Header `Location` trỏ URL resource — client và cache hiểu đúng semantics.

**200 OK** — thành công, thường cho GET hoặc PUT update trả body.

**204 No Content** — thành công, không body. DELETE thành công, hoặc PATCH chỉ update status:

```java
@DeleteMapping("/appointments/{id}")
@ResponseStatus(HttpStatus.NO_CONTENT)
public void cancel(@PathVariable UUID id) {
  appointmentService.cancel(id);
}
```

Trả 200 với body `{"deleted": true}` cũng được nhưng 204 gọn hơn — chọn một convention trong team và giữ nhất quán.

---

## 400, 422, 409 — client errors có hương vị khác nhau

**400 Bad Request** — malformed JSON, thiếu field bắt buộc, UUID format sai:

```java
@ExceptionHandler(MethodArgumentNotValidException.class)
public ResponseEntity<ApiError> handleValidation(MethodArgumentNotValidException ex) {
  return ResponseEntity.badRequest().body(ApiError.of("VALIDATION_ERROR", ...));
}
```

**404 Not Found** — resource ID không tồn tại (hoặc không visible với user — có team dùng 404 thay vì 403 để không leak "tồn tại nhưng không phải của mày").

**409 Conflict** — state hiện tại không cho phép action: đặt slot đã full, cancel appointment đã completed:

```java
throw new ConflictException("SLOT_NOT_AVAILABLE", "Khung giờ đã được đặt");
// → 409
```

**422 Unprocessable Entity** — JSON hợp lệ nhưng business rule fail: ngày hẹn trong quá khứ. Spring không map sẵn; nhiều API dùng 400 cho cả case này — quan trọng là **document** và consistent.

**401 Unauthorized** — chưa authenticate (thiếu JWT, token hết hạn). Tên historical — nghĩa là "chưa xác thực".

**403 Forbidden** — đã authenticate nhưng không đủ quyền.

---

## Đừng bọc mọi exception thành 500

```java
// ❌ Global handler trả 500 cho mọi thứ
@ExceptionHandler(Exception.class)
public ResponseEntity<ApiError> handleAll(Exception ex) {
  return ResponseEntity.status(500).body(...);
}
```

`NotFoundException` → 404. `ValidationException` → 400. `ConflictException` → 409. Chỉ **unexpected** exception → 500 và log stack trace (không leak stack ra client prod).

```java
@RestControllerAdvice
public class GlobalExceptionHandler {

  @ExceptionHandler(NotFoundException.class)
  public ResponseEntity<ApiError> notFound(NotFoundException ex) {
    return ResponseEntity.status(HttpStatus.NOT_FOUND)
        .body(ApiError.of(ex.getCode(), ex.getMessage()));
  }

  @ExceptionHandler(Exception.class)
  public ResponseEntity<ApiError> unexpected(Exception ex) {
    log.error("Unhandled", ex);
    return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR)
        .body(ApiError.of("INTERNAL_ERROR", "Đã xảy ra lỗi hệ thống"));
  }
}
```

---

## Tại sao monitoring cần status đúng

Alert rule: *"5xx rate > 1% trong 5 phút"* — chỉ có nghĩa khi 5xx thật sự là server fault. Nếu mày nhét 404 vào 200 body — alert không bao giờ fire cho spike "not found" bất thường (có thể attack scan ID).

API gateway, CDN, client retry library — đều dựa status code. Chuẩn hóa giúp **cả hệ sinh thái** hoạt động, không chỉ app React của mày.

---

## Anti-pattern: 200 + success flag

```java
// ❌
return ResponseEntity.ok(Map.of("success", false, "error", "NOT_FOUND"));
```

Frontend phải:

```javascript
const res = await fetch(...);
if (!res.ok) { ... }  // không bao giờ vào đây
const data = await res.json();
if (!data.success) { ... }  // phải nhớ check
```

Mất lợi ích của `res.ok`. Test integration khó assert. Cache có thể cache "200" cho error response.

Nếu mày cần machine-readable error trong body — vẫn dùng đúng status **và** body:

```json
HTTP/1.1 404 Not Found
{ "code": "APPOINTMENT_NOT_FOUND", "message": "..." }
```

---

## Takeaway

Status code là API contract phần không thể thương lượng. 2xx = thành công, 4xx = caller sửa request hoặc quyền, 5xx = server phải investigate. 201 khi tạo mới, 409 khi conflict. Trước khi ship endpoint mới, hỏi: *"Nếu tao là Prometheus alert, tao hiểu request này fail vì ai không?"* — nếu câu trả lời chỉ nằm trong JSON body với status 200, mày đang làm sai.

---

*Bài tiếp theo: Password reset flow — one-time token và expiry.*
