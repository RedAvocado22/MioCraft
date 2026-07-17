---
title: "Complexity không chứng minh bạn giỏi — đơn giản mới chứng minh bạn hiểu sâu"
description: "Code phức tạp thường là dấu hiệu của sự chưa chín — không phải sự tinh tế. Người giỏi nhất thường viết code đơn giản nhất."
category: programming
pubDate: 2024-01-09
series: "Phần 1: Tư duy lập trình"
tags: ["mindset", "simplicity", "clean-code"]
---

Có một nghịch lý thú vị trong nghề lập trình: code phức tạp thường trông *impressive* hơn code đơn giản — đặc biệt với người chưa có kinh nghiệm. Nhưng với người có kinh nghiệm, điều ngược lại mới đúng: code đơn giản là thứ khó viết hơn, và nó thường chứng minh sự hiểu biết sâu hơn.

---

## Tại sao complexity trông impressive

Khi bạn mới học lập trình, complexity là dấu hiệu của sự nỗ lực và kiến thức. Code nhiều dòng hơn = làm nhiều hơn = giỏi hơn. Pattern nhiều layer hơn = hiểu nhiều hơn = xịn hơn.

Đây không hoàn toàn sai — complexity đôi khi là cần thiết. Nhưng đây là điều mà người mới chưa phân biệt được: **essential complexity** (phức tạp vì bài toán thật sự phức tạp) vs **accidental complexity** (phức tạp vì solution được thiết kế kém).

---

## Essential vs Accidental complexity

**Essential complexity** là độ phức tạp vốn có của bài toán — thứ bạn không thể loại bỏ mà không làm mất đi yêu cầu của bài toán.

Ví dụ: concurrent appointment booking là vốn phức tạp vì bạn cần đảm bảo atomicity khi nhiều users cùng modify shared state. Độ phức tạp đó là essential — nó đến từ nature của bài toán, không phải từ solution.

**Accidental complexity** là độ phức tạp bạn tự thêm vào — thường không có ý thức — qua những abstraction không cần thiết, những layer trung gian không add value, những pattern được apply không đúng chỗ.

```java
// Accidental complexity — quá nhiều abstraction không cần thiết
public interface AppointmentBookingStrategy {
    BookingResult execute(BookingContext context);
}

public class StandardAppointmentBookingStrategy implements AppointmentBookingStrategy {
    @Override
    public BookingResult execute(BookingContext context) {
        return appointmentBookingProcessor.process(
            AppointmentBookingRequest.from(context)
        );
    }
}

public class AppointmentBookingProcessor {
    public BookingResult process(AppointmentBookingRequest request) {
        // Actual logic ở đây — nhưng phải đi qua 2 layer không làm gì
    }
}
```

```java
// Essential complexity — chỉ những gì cần thiết
public BookingResponse bookAppointment(BookingRequest request) {
    // Actual logic ở đây, không có layer trung gian vô nghĩa
}
```

---

## Dấu hiệu của accidental complexity

**Nhiều layer nhưng mỗi layer không làm gì thực sự.** Nếu bạn trace một request qua 5 class và mỗi class chỉ gọi method ở class tiếp theo mà không add logic, đó là layer không earn its keep.

**Abstract class và interface cho những thứ chỉ có một implementation.** Interface là powerful khi bạn có nhiều implementation hoặc cần dependency injection. Nhưng `UserService` implements `IUserService` khi không bao giờ có implementation thứ hai là ceremony, không phải design.

**Config và customization cho những thứ không bao giờ được customize.** Đây là YAGNI problem — bạn build flexibility mà không ai dùng.

**Code khó đọc hơn mức bài toán đòi hỏi.** Nếu người đọc code của bạn cần nhiều hơn 30 giây để hiểu một method làm gì — và method đó không handle một bài toán thật sự phức tạp — đó là signal.

---

## Đơn giản khó hơn bạn nghĩ

Viết code đơn giản thật sự khó. Không phải vì thiếu kiến thức — mà vì nó đòi hỏi bạn phải hiểu bài toán đủ sâu để strip away những gì không cần thiết mà vẫn giữ lại đủ những gì cần.

Khi bạn chưa hiểu đủ, bạn có xu hướng over-generalize — build cho tất cả các cases có thể thay vì cho case thực sự cần. Và over-generalization sinh ra accidental complexity.

Khi bạn hiểu sâu, bạn có thể đưa ra những simplifying assumptions có cơ sở — biết rằng case X sẽ không xảy ra, case Y không cần handle theo cách generic. Và những assumptions đó cho phép bạn viết code đơn giản hơn mà vẫn đúng.

---

## Ví dụ thực tế — Refactor về đơn giản hơn

Đây là một đoạn code trong một ABAC implementation:

```java
// Version phức tạp
public Specification<MedicalRecord> buildSpecification(
    MedicalRecordSearchRequest request,
    UserContextProvider contextProvider,
    RoleEvaluatorChain roleChain,
    FilterStrategyResolver strategyResolver
) {
    UserContext ctx = contextProvider.getCurrentContext();
    FilterStrategy strategy = strategyResolver.resolve(ctx, roleChain);
    return strategy.apply(request, ctx);
}
```

```java
// Version đơn giản hơn — sau khi hiểu rõ bài toán
public Specification<MedicalRecord> buildSpecification(
    MedicalRecordSearchRequest request,
    UserContext userContext
) {
    UUID doctorId = userContext.hasRole("ROLE_DOCTOR") 
        ? userContext.getUserId() 
        : null;
    return MedicalRecordSpecification.withFilters(request, doctorId);
}
```

Version hai không "kém hơn" — nó đơn giản hơn vì đã hiểu rõ bài toán: chỉ có hai case (admin thấy tất cả, doctor thấy của mình), không cần generic strategy resolver.

---

## Một test đơn giản

Trước khi merge code, hãy tự hỏi: *"Nếu mình phải xóa hết và viết lại feature này, mình có viết nó theo cách này không?"*

Nếu câu trả lời là không — hãy tìm hiểu tại sao. Thường thì bạn sẽ phát hiện ra những layer, những abstraction, những complexity mà bạn đã thêm vào theo quán tính chứ không phải vì cần thiết.

---

## Takeaway

Lần tới khi bạn viết xong một đoạn code và thấy nó trông "impressive" — hãy dừng lại. Hỏi: *"Đây là essential complexity của bài toán, hay là accidental complexity của solution?"*

Nếu là accidental — simplify. Code đơn giản nhất giải quyết được bài toán là code tốt nhất. Không phải vì nó ít effort, mà vì nó chứng minh bạn đã hiểu đủ sâu để bỏ đi những gì không cần.

---

*Bài tiếp theo: Debug chậm không phải vì bạn dở — bạn đang debug sai cách.*
