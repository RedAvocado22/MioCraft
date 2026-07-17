---
title: "Refactor kiến trúc không phải là viết lại — là chỉnh hướng dần dần"
description: "Big bang rewrite thất bại 90% thời gian. Kiến trúc tốt được xây dựng bằng cách di chuyển dần — từng boundary một — không phải bắt đầu từ đầu."
category: architecture
pubDate: 2024-01-30
series: "Phần 3: Kiến trúc phần mềm"
tags: ["architecture", "refactoring", "migration"]
---

Có một cuộc trò chuyện xảy ra ở hầu hết mọi team khi họ nhận ra kiến trúc hiện tại đang có vấn đề:

*"Chúng ta cần refactor toàn bộ codebase."*

*"Tốn bao lâu?"*

*"Khoảng hai tháng nếu tập trung."*

*"Trong hai tháng đó, feature mới thì sao?"*

*"... Dừng lại."*

Và đó là lúc cuộc trò chuyện chết. Không công ty nào dừng development hai tháng để refactor. Không team nào thuyết phục được management đầu tư đủ thời gian cho một "rewrite" lớn. Kết quả: architectural refactor không bao giờ xảy ra, technical debt tiếp tục tích lũy, và sau một năm nữa cùng cuộc trò chuyện đó lặp lại — lần này với con số "sáu tháng."

Có cách làm khác.

---

## Strangler Fig Pattern — migrate dần mà không dừng lại

Cái tên nghe lạ nhưng ý tưởng rất thực tế: như cây strangler fig trong rừng nhiệt đới mọc dần quanh cây chủ, eventually thay thế hoàn toàn — bạn build cấu trúc mới song song với cái cũ, và migrate từng phần nhỏ.

Trong thực tế với HMS: giả sử `AppointmentService` đang fat và cần chuyển sang architecture Use Case. Thay vì viết lại toàn bộ:

**Bước 1**: Tạo `BookAppointmentUseCase` mới, với logic đúng. Giữ `AppointmentService.bookAppointment()` nguyên.

**Bước 2**: Đổi controller từ gọi `AppointmentService` sang gọi `BookAppointmentUseCase`.

**Bước 3**: Chạy song song một thời gian, test kỹ. Khi tin tưởng, xóa `AppointmentService.bookAppointment()`.

**Bước 4**: Làm tương tự với `cancelAppointment`, `confirmAppointment`, từng use case một.

Mỗi bước là một PR nhỏ, có thể review được, có thể test được, có thể rollback được. Không có "feature freeze." Development tiếp tục trong suốt quá trình.

---

## Nguyên tắc của incremental architectural refactor

**Rule 1: Không bao giờ refactor và thêm feature trong cùng một PR.**

Đây là quy tắc quan trọng nhất. Khi bạn mix refactor với feature, không ai review được vì không rõ behavior nào mới, behavior nào cũ. Bug xuất hiện và không ai biết bug đến từ refactor hay từ feature. Giữ hai thứ tách biệt hoàn toàn.

**Rule 2: Mỗi bước refactor phải có test cover trước khi làm.**

Bạn không thể refactor an toàn nếu không có test. Trình tự đúng: viết test cho behavior hiện tại → refactor → chạy test xác nhận behavior không đổi. Nếu không có test và bạn refactor, bạn đang đoán mò.

**Rule 3: Chọn điểm bắt đầu là nơi đau nhất, không phải nơi dễ nhất.**

Nhiều developer bắt đầu refactor từ những class đơn giản vì "dễ làm sạch." Đó là lãng phí thời gian. Bắt đầu từ class gây ra nhiều vấn đề nhất — fat service mà mọi người sợ sửa, module mà bug hay xuất hiện nhất. Đó là nơi architectural investment tạo ra ROI cao nhất.

---

## Ví dụ thực tế: migrate một method tại một thời điểm

```java
// Trạng thái hiện tại: AppointmentService fat với nhiều method
@Service
public class AppointmentService {
    public AppointmentResponse bookAppointment(BookingRequest req) { /* 60 dòng */ }
    public void cancelAppointment(UUID id) { /* 30 dòng */ }
    public AppointmentResponse reschedule(UUID id, RescheduleRequest req) { /* 40 dòng */ }
    // ... 10 method khác
}

// Bước 1: Extract bookAppointment ra Use Case mới
// AppointmentService vẫn còn nguyên — không xóa gì
@Component
public class BookAppointmentUseCase {
    public AppointmentResult execute(BookAppointmentCommand command) {
        // Logic mới, clean hơn
    }
}

// Bước 2: Controller delegate sang use case mới
@PostMapping("/appointments")
public ResponseEntity<?> book(@RequestBody BookingRequest request) {
    // Gọi use case thay vì service
    AppointmentResult result = bookAppointmentUseCase.execute(...);
    return ResponseEntity.ok(AppointmentResponse.from(result));
}

// Bước 3: Sau khi test và confident, đánh @Deprecated trên method cũ
@Service
public class AppointmentService {
    
    @Deprecated(since = "2025-01", forRemoval = true)
    public AppointmentResponse bookAppointment(BookingRequest req) { ... }
    
    // Các method khác vẫn nguyên — migrate dần
}

// Bước 4: Sau một sprint, xóa method cũ
// Bước 5: Lặp lại cho cancelAppointment, reschedule, v.v.
```

Sau bốn sprint, `AppointmentService` có thể đã không còn method nào — hoặc chỉ còn những thứ thực sự đơn giản không cần Use Case riêng. Toàn bộ migration xảy ra song song với development bình thường.

---

## Khi nào thì "viết lại" mới là đáp án đúng

Đôi khi codebase đã đến trạng thái không thể cứu được — coupling quá sâu, không có test, domain logic bị nhúng vào trigger database. Lúc đó viết lại từ đầu là lựa chọn thực tế hơn.

Nhưng ngay cả khi viết lại, nguyên tắc tương tự áp dụng: không viết lại toàn bộ cùng lúc. Chạy hai hệ thống song song, migrate từng domain một, và sunset cái cũ khi cái mới đã stable. "Big bang rewrite" — tắt hệ thống cũ, bật hệ thống mới — là lý do của không ít production incident lớn nhất trong lịch sử phần mềm.

---

## Takeaway

Lần tới khi bạn nhìn vào một class cần refactor, thay vì hỏi "viết lại hết mất bao lâu", hãy hỏi: *"Method nào trong class này mình có thể extract ra và migrate riêng trong một PR nhỏ?"* Bắt đầu từ đó.

---

*Bài tiếp theo: Microservices không phải level up tự động từ Monolith*
