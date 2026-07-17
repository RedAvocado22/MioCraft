---
title: "Code không test được thì chưa bao giờ là Clean Code"
description: "Khả năng test được là thuộc tính thiết kế, không phải afterthought. Code khó test là code có quá nhiều coupling và quá nhiều responsibility."
category: programming
pubDate: 2024-01-18
series: "Phần 2: Clean Code"
tags: ["clean-code", "testing", "testability"]
---

Có một bài kiểm tra nhanh mình hay dùng để đánh giá chất lượng code: thử viết unit test cho nó. Không cần chạy — chỉ cần thử *viết*.

Nếu bạn phải spin up database để test business logic — code có vấn đề. Nếu bạn phải mock mười dependency khác nhau để test một function hai mươi dòng — code có vấn đề. Nếu bạn không thể nghĩ ra cách test nó mà không cần cả hệ thống chạy lên — code có vấn đề nghiêm trọng.

Testability không phải là attribute tách rời của code. Nó là triệu chứng.

## Tại sao code không test được thường là code xấu

Code khó test vì nó vi phạm một trong những nguyên tắc cơ bản: **dependency phải được inject, không phải được tạo ra bên trong**.

```java
// ❌ Vấn đề — impossible to unit test
public class AppointmentService {

    public BigDecimal calculatePatientShare(Long appointmentId) {
        // Hard dependency — không thể mock
        AppointmentRepository repo = new AppointmentRepository();
        InsuranceService insuranceService = new InsuranceService();
        NotificationService notificationService = new NotificationService();

        Appointment appointment = repo.findById(appointmentId).orElseThrow();
        InsuranceCoverage coverage = insuranceService.calculate(appointment.getPatientId());
        BigDecimal share = appointment.getTotalFee().subtract(coverage.getCoveredAmount());

        // Side effect trong business logic — sai về thiết kế
        notificationService.sendPaymentBreakdown(appointment, share);

        return share;
    }
}
```

Để test `calculatePatientShare`, bạn cần database thật, insurance service thật, notification service thật. Đây không phải unit test nữa — đây là integration test ngẫu nhiên bị mắc kẹt trong service layer.

## Code testable trông như thế nào

```java
// ✅ Tốt hơn — dependencies được inject, side effect tách ra
@Service
@RequiredArgsConstructor
public class AppointmentService {

    private final AppointmentRepository appointmentRepository;
    private final InsuranceService insuranceService;
    // NotificationService không còn ở đây — notification là side effect,
    // nên được trigger qua event, không phải gọi trực tiếp từ calculation logic

    public BigDecimal calculatePatientShare(Long appointmentId) {
        Appointment appointment = appointmentRepository.findById(appointmentId)
            .orElseThrow(() -> new AppointmentNotFoundException(appointmentId));
        return calculatePatientShare(appointment);
    }

    // Overload với Appointment object — testable mà không cần database
    public BigDecimal calculatePatientShare(Appointment appointment) {
        InsuranceCoverage coverage = insuranceService.calculate(appointment.getPatientId());
        return appointment.getTotalFee().subtract(coverage.getCoveredAmount());
    }
}
```

Bây giờ test trở nên straightforward:

```java
@ExtendWith(MockitoExtension.class)
class AppointmentServiceTest {

    @Mock
    private AppointmentRepository appointmentRepository;

    @Mock
    private InsuranceService insuranceService;

    @InjectMocks
    private AppointmentService appointmentService;

    @Test
    void calculatePatientShare_shouldSubtractCoveredAmountFromTotalFee() {
        // Arrange
        Appointment appointment = buildAppointment(
            BigDecimal.valueOf(500_000) // total fee
        );
        InsuranceCoverage coverage = InsuranceCoverage.of(BigDecimal.valueOf(200_000));
        when(insuranceService.calculate(appointment.getPatientId())).thenReturn(coverage);

        // Act
        BigDecimal patientShare = appointmentService.calculatePatientShare(appointment);

        // Assert
        assertThat(patientShare).isEqualByComparingTo(BigDecimal.valueOf(300_000));
    }

    @Test
    void calculatePatientShare_whenNoInsurance_shouldReturnFullFee() {
        Appointment appointment = buildAppointment(BigDecimal.valueOf(500_000));
        InsuranceCoverage noInsurance = InsuranceCoverage.none();
        when(insuranceService.calculate(appointment.getPatientId())).thenReturn(noInsurance);

        BigDecimal patientShare = appointmentService.calculatePatientShare(appointment);

        assertThat(patientShare).isEqualByComparingTo(BigDecimal.valueOf(500_000));
    }
}
```

Không cần database. Không cần Spring context. Chạy trong milliseconds. Test business logic thuần túy.

## Ba dấu hiệu code không testable

**1. New operator trong business logic.** Bất cứ khi nào business logic dùng `new SomeService()` hay `new SomeRepository()` — đó là hard dependency. Bạn không thể thay thế nó bằng mock.

**2. Static method calls với side effect.** `LocalDateTime.now()`, `UUID.randomUUID()` — những cái này ổn ở mức độ nào đó. Nhưng `ExternalPaymentGateway.charge()` là static với side effect — không thể test mà không gọi thật.

**3. Logic bị trộn lẫn với I/O.** Database call, HTTP call, file system — tất cả là I/O và nên được tách ra khỏi business logic. Logic thuần túy (tính toán, validation, state transition) phải test được mà không cần I/O.

## Điều quan trọng hơn test coverage

Sinh viên hay hỏi: "Cần bao nhiêu phần trăm coverage?" Câu hỏi đó đặt sai. Coverage cao không đồng nghĩa với test tốt. Bạn có thể đạt 90% coverage với những test không assert gì, hoặc chỉ test happy path mà bỏ qua toàn bộ edge case.

Câu hỏi đúng là: **Test có thể bắt được bug thật không?**

Và để test bắt được bug thật, bạn phải test:

- Happy path: input hợp lệ, kết quả đúng
- Edge case: null, empty, boundary value
- Error path: service throw exception thì caller làm gì?

```java
@Test
void calculatePatientShare_whenInsuranceServiceFails_shouldThrowProperException() {
    Appointment appointment = buildAppointment(BigDecimal.valueOf(500_000));
    when(insuranceService.calculate(any()))
        .thenThrow(new InsuranceServiceUnavailableException("Service timeout"));

    assertThatThrownBy(() -> appointmentService.calculatePatientShare(appointment))
        .isInstanceOf(InsuranceVerificationFailedException.class);
}
```

## Testability là design feedback

Đây là insight quan trọng nhất của bài này: **khi code khó test, đó là design đang phàn nàn với bạn.**

Code dễ test thường là code với:
- Separation of concerns rõ ràng
- Dependency injection được dùng đúng
- Business logic tách biệt khỏi infrastructure
- Function nhỏ và làm một việc

Code khó test thường là code vi phạm những nguyên tắc trên. Testability không phải là mục đích — nó là hệ quả của design tốt. Và nếu bạn không thể test được, đó là signal để nhìn lại design.

## Takeaway

Chọn một service method quan trọng trong HMS — `confirmAppointment`, `processPayment`, bất kỳ method nào mà nếu sai thì nghiêm trọng. Thử viết một unit test cho nó. Xem bạn gặp khó khăn ở đâu — đó chính là điểm yếu trong design của bạn.

---

*Bài tiếp theo: Refactor là gì — và khi nào thì nên làm*
