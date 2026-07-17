---
title: "Monolith vs Microservices — chọn sai kiến trúc là đốt cả năm"
description: "Microservices không phải bước tiến hoá tự nhiên của Monolith. Đây là hai lựa chọn kiến trúc khác nhau, giải quyết vấn đề khác nhau — và cái giá của việc chọn sai rất đắt."
category: system-design
pubDate: 2024-03-09
series: "Phần 8: System Design"
tags: ["system-design", "microservices", "monolith", "architecture"]
---

Năm 2023, một startup fintech ở Việt Nam quyết định xây sản phẩm mới theo microservices ngay từ ngày đầu. Lý do: team đã đọc về Netflix, Amazon, Uber — tất cả đều dùng microservices. Họ cũng muốn "scale được."

Sáu tháng sau, họ có mười hai service. Một tính năng đơn giản như "xem lịch sử giao dịch" phải call qua năm service khác nhau. Mỗi lần deploy phải coordinate giữa ba team. Bug tracing mất gấp đôi thời gian vì log nằm rải rác. Và product vẫn chưa có user.

Đây không phải câu chuyện về microservices xấu. Đây là câu chuyện về việc chọn kiến trúc không phù hợp với context.

---

## Monolith không phải từ xấu

Trong giới dev, "monolith" đôi khi được dùng như một từ miệt thị — kiến trúc cũ kỹ, không scale được, của người không biết làm tốt hơn. Đó là một hiểu lầm nghiêm trọng.

Monolith là kiến trúc trong đó toàn bộ application được deploy như một unit duy nhất. Tất cả business logic — appointment booking, doctor schedule, patient management, billing — nằm trong cùng một process, cùng một codebase, deploy cùng một lúc.

Điều đó không có nghĩa là code phải nhồi nhét lộn xộn. Một monolith tốt vẫn có layered architecture rõ ràng, module separation đúng đắn, bounded context được respect. Sự khác biệt là ở deployment unit — một cái binary, chạy trên một hoặc vài server.

Và monolith có những ưu điểm rất thực tế: transaction across modules là trivial (một `@Transactional` là xong), debugging đơn giản hơn vì tất cả trong một process, deployment đơn giản hơn, developer experience tốt hơn khi team còn nhỏ.

---

## Microservices giải quyết vấn đề gì — và vấn đề gì nó tạo ra

Microservices ra đời để giải quyết vấn đề scale của những công ty rất lớn. Khi Amazon có hàng trăm team làm việc trên cùng một codebase, deploy của một team bị block bởi team khác. Khi một phần của hệ thống cần scale gấp mười lần nhưng phần khác thì không, deploy toàn bộ monolith lãng phí tài nguyên. Đó là context ra đời của microservices.

Đổi lại, microservices tạo ra một tập vấn đề mới:

**Network calls thay thế function calls.** Khi `AppointmentService` cần data từ `DoctorService`, đó không còn là một method call nữa — đó là HTTP request hoặc gRPC call, có latency, có thể fail, có thể timeout. Bạn phải xử lý tất cả những case đó.

**Distributed transactions là địa ngục.** Nếu booking một appointment cần write vào cả `appointment-service` lẫn `notification-service`, và `notification-service` fail giữa chừng, bạn rollback bằng cách nào? Đây là lý do Saga pattern tồn tại — và Saga pattern phức tạp hơn `@Transactional` rất nhiều.

**Operational overhead tăng đột biến.** Thay vì deploy một service, bạn deploy mười service. Thay vì monitor một process, bạn monitor mười process. Service discovery, load balancing, distributed tracing — tất cả đều trở thành thứ bạn phải quản lý.

---

## Quyết định thực sự: không phải monolith hay microservices

Câu hỏi đúng không phải là "dùng monolith hay microservices?" — đó là câu hỏi sai level. Câu hỏi đúng là: **"Vấn đề gì đang khiến architecture hiện tại không còn đủ?"**

Nếu câu trả lời là "team quá nhiều người, deploy block lẫn nhau" — microservices có thể là giải pháp.

Nếu câu trả lời là "một component cần scale gấp mười lần phần còn lại" — microservices cho component đó có thể đáng xem xét.

Nếu câu trả lời là "mình muốn hệ thống scale được sau này" — đó không phải vấn đề cần giải quyết ngay bây giờ.

Amazon nổi tiếng với câu nói "we started as a monolith." Shopify vẫn chạy monolith Ruby on Rails ở scale hàng tỷ đô. Stack Overflow cho đến gần đây vẫn là một monolith phục vụ hàng triệu request mỗi ngày với đội ngũ kỹ thuật tương đối nhỏ.

---

## Modular Monolith — con đường ở giữa

Có một kiến trúc mà ít người nói đến nhưng rất practical: **Modular Monolith**. Đây là monolith được tổ chức thành modules có boundary rõ ràng — mỗi module có package riêng, không cho phép truy cập cross-module trực tiếp mà phải qua interface.

Trong HMS của bạn, đó có nghĩa là: `appointment` module không được import trực tiếp class từ `billing` module — chúng giao tiếp qua interface hoặc event. Codebase vẫn được deploy như một unit, nhưng về mặt code organization thì đã có separation đủ để sau này, nếu cần, tách ra thành microservices mà không phải viết lại toàn bộ.

Đây là cách tiếp cận thực tế cho hầu hết team nhỏ và startup: build monolith với module boundary tốt, scale đến khi thật sự cần tách ra, rồi tách từng module có vấn đề scale.

```java
// ❌ Monolith không có boundary — appointment biết quá nhiều về billing
@Service
public class AppointmentService {
    @Autowired
    private PaymentRepository paymentRepository; // coupling trực tiếp
    
    public void createAppointment(AppointmentRequest req) {
        // ... tạo appointment
        Payment payment = paymentRepository.findLatestByPatient(req.getPatientId());
        // dùng payment data để validate gì đó
    }
}

// ✅ Modular boundary — appointment chỉ biết interface, không biết implementation
@Service
public class AppointmentService {
    @Autowired
    private PatientEligibilityPort eligibilityPort; // interface, không phải concrete class
    
    public void createAppointment(AppointmentRequest req) {
        // ... tạo appointment
        if (!eligibilityPort.isEligible(req.getPatientId())) {
            throw new PatientNotEligibleException();
        }
    }
}
```

`PatientEligibilityPort` là interface được implement bởi billing module — nhưng appointment module không cần biết điều đó. Khi cần tách ra microservices, chỉ cần thay implementation của port từ direct call thành HTTP call.

---

## Takeaway

Nếu bạn đang xây HMS cho đồ án hoặc một startup nhỏ, câu trả lời gần như chắc chắn là monolith — nhưng là modular monolith với boundary rõ ràng. Đừng để "sau này sẽ phải scale" là lý do để add complexity ngay hôm nay. Complexity phải được justify bởi vấn đề hiện tại, không phải vấn đề tưởng tượng.

---

*Bài tiếp theo: API Design — vì sao 70% lỗi hệ thống bắt nguồn từ API tệ*
