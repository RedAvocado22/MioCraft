---
title: "API Design — vì sao 70% lỗi hệ thống bắt nguồn từ API tệ"
description: "API xấu không gây lỗi ngay — nó tạo ra misunderstanding giữa các team, edge case không được handle, và coupling ẩn tích lũy theo thời gian."
category: system-design
pubDate: 2024-03-10
series: "Phần 8: System Design"
tags: ["API", "REST", "system-design", "design"]
---

API là contract. Một khi bạn publish nó ra và client bắt đầu dùng, bạn không thể tự tiện thay đổi nó mà không break người khác.

Cái sự thật đó nghe có vẻ đơn giản. Nhưng phần lớn dev — kể cả những người đã làm lâu năm — không thực sự internalize nó. Họ nghĩ API chỉ là URL và JSON. Thực ra, API là surface area của hệ thống bạn với thế giới bên ngoài, và thiết kế nó tệ thì consequences lan ra rất xa.

---

## Những sai lầm API design phổ biến nhất

**Leak internal implementation.** Đây là lỗi thường gặp nhất. API trả về entity trực tiếp từ database:

```java
// ❌ Leak implementation detail
@GetMapping("/appointments/{id}")
public Appointment getAppointment(@PathVariable UUID id) {
    return appointmentRepository.findById(id).orElseThrow();
}
```

`Appointment` entity có `createdAt`, `updatedAt`, `version` (optimistic lock), `deletedAt` (soft delete), `internalStatusCode`. Client nhìn thấy tất cả. Rồi một ngày bạn refactor database schema — rename column, split entity, thêm field — toàn bộ client phải update. Bạn đã bind contract của bạn vào implementation detail của bạn.

Đúng ra response phải là một DTO được thiết kế riêng cho API contract:

```java
// ✅ DTO tách biệt khỏi entity
@GetMapping("/appointments/{id}")
public AppointmentResponse getAppointment(@PathVariable UUID id) {
    return appointmentService.getById(id); // service map sang DTO
}

public record AppointmentResponse(
    UUID id,
    String patientName,
    String doctorName,
    LocalDateTime scheduledAt,
    AppointmentStatus status
) {}
```

Giờ bạn có thể thay đổi entity thoải mái, miễn là `AppointmentResponse` vẫn giữ nguyên shape.

**Inconsistent error responses.** Client của bạn — có thể là frontend React của chính bạn, có thể là mobile app sau này — cần handle lỗi theo cách nhất quán. Nếu endpoint này trả về `{"error": "Not found"}`, endpoint kia trả về `{"message": "Appointment not found", "code": 404}`, endpoint thứ ba throw exception và trả về HTML stacktrace — client phải viết ba cách handle lỗi khác nhau, và bất kỳ cái nào bạn quên handle đều thành bug ở production.

Một error response schema nhất quán cho toàn hệ thống:

```java
public record ApiError(
    String code,        // machine-readable: "APPOINTMENT_NOT_FOUND"
    String message,     // human-readable: "Appointment không tồn tại"
    Instant timestamp,
    String path
) {}
```

**Thiếu versioning.** API không có version thì không thể evolve. Nếu bạn cần thay đổi shape của response vì business requirement mới, bạn sẽ phải either break existing client hoặc add workaround xấu xí vào code. Versioning đơn giản nhất là path-based: `/api/v1/appointments`. Khi cần breaking change, tạo `/api/v2/appointments` và deprecate v1.

**Ambiguous status codes.** Trả về HTTP 200 cho tất cả mọi thứ, kể cả lỗi, là một pattern thật sự tồn tại ngoài đời. Đừng làm vậy. HTTP status codes là một phần của protocol — 201 Created khi tạo resource mới, 404 khi không tìm thấy, 409 Conflict khi có race condition, 422 Unprocessable Entity khi validation fail. Client có thể đọc status code mà không cần parse response body.

---

## Idempotency — thứ ít ai nghĩ đến lúc thiết kế

Network là không tin cậy. Client gửi request, server xử lý xong, nhưng response bị timeout trước khi về đến client. Client không biết server đã xử lý chưa — nó sẽ retry. Nếu operation đó không idempotent, bạn có thể tạo duplicate appointment, charge tiền hai lần, gửi notification hai lần.

GET, PUT, DELETE là idempotent theo convention — gọi nhiều lần với cùng input thì result như nhau. POST thì không phải mặc định.

Với những POST endpoint quan trọng — tạo booking, tạo payment — bạn cần thiết kế explicit idempotency:

```java
// Client gửi idempotency key trong header
// X-Idempotency-Key: 550e8400-e29b-41d4-a716-446655440000

@PostMapping("/appointments")
public ResponseEntity<AppointmentResponse> createAppointment(
    @RequestHeader("X-Idempotency-Key") UUID idempotencyKey,
    @RequestBody AppointmentRequest request
) {
    return appointmentService.createWithIdempotency(idempotencyKey, request);
}
```

Server lưu idempotency key lại. Nếu request với cùng key đến lần hai, trả về kết quả của lần đầu mà không process lại. Client retry an toàn.

---

## Pagination — không phải optional

Bất kỳ endpoint nào trả về list đều phải có pagination. Không có exception. Hôm nay HMS có 100 appointment. Năm sau có 100,000. Nếu API của bạn không có pagination, khi data lớn dần query sẽ chậm, memory sẽ tăng, và response size sẽ tăng đến mức client timeout.

```java
// ✅ Luôn paginate list endpoints
@GetMapping("/appointments")
public Page<AppointmentResponse> getAppointments(
    @RequestParam(defaultValue = "0") int page,
    @RequestParam(defaultValue = "20") int size,
    @RequestParam(required = false) UUID doctorId,
    @RequestParam(required = false) LocalDate date
) {
    return appointmentService.findAll(doctorId, date, PageRequest.of(page, size));
}
```

Response nên bao gồm metadata: tổng số items, tổng số pages, trang hiện tại. Client cần những thông tin đó để render pagination UI đúng cách.

---

## API documentation không phải optional

API document là contract được viết ra. Frontend dev của bạn — có thể là bạn cùng nhóm, có thể là chính bạn một tuần sau — cần biết endpoint nào nhận gì, trả về gì, lỗi ra sao. Springdoc OpenAPI với một annotation đơn giản tự động generate Swagger UI:

```java
@Operation(summary = "Tạo appointment mới")
@ApiResponses({
    @ApiResponse(responseCode = "201", description = "Tạo thành công"),
    @ApiResponse(responseCode = "409", description = "Slot đã được đặt"),
    @ApiResponse(responseCode = "422", description = "Dữ liệu không hợp lệ")
})
@PostMapping("/appointments")
public ResponseEntity<AppointmentResponse> create(...) { ... }
```

---

## Takeaway

Trước khi implement bất kỳ endpoint mới nào, viết ra response schema và error cases trước. Nếu bạn không thể mô tả rõ ràng "endpoint này nhận gì, trả về gì, và fail như thế nào" trước khi code, bạn chưa sẵn sàng implement nó.

---

*Bài tiếp theo: Load Balancer — bí mật giúp hệ thống chịu hàng chục nghìn request/giây*
