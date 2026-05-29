---
title: "SOLID không làm code tốt hơn nếu mày dùng sai thời điểm"
description: "Áp dụng SOLID quá sớm tạo ra over-engineering. Áp dụng quá muộn tạo ra debt. Biết khi nào cần dùng mới là kỹ năng thật sự."
category: programming
pubDate: 2024-02-08
series: "Phần 4: SOLID"
tags: ["SOLID", "mindset", "over-engineering"]
---

Sau khi đọc xong năm bài về SOLID, có một cái bẫy rất phổ biến mà junior thường rơi vào: áp dụng tất cả mọi thứ ngay lập tức, mọi lúc, cho mọi dòng code.

Kết quả là một codebase có mười lăm interface cho mười lăm class, mỗi class dài mười dòng, không ai hiểu tại sao từng thứ tồn tại, và để trace qua một business flow đơn giản mày phải nhảy qua tám file khác nhau.

Đây không phải SOLID. Đây là **over-engineering được justified bằng SOLID**.

---

## SOLID giải quyết vấn đề thay đổi — nhưng không phải mọi code đều thay đổi theo cùng một cách

Nhìn lại lý do tại sao từng nguyên tắc tồn tại:

- **SRP** giải quyết vấn đề: một class bị nhiều nhóm người yêu cầu thay đổi vì nhiều lý do khác nhau
- **OCP** giải quyết vấn đề: thêm behavior mới buộc phải sửa code đang hoạt động
- **LSP** giải quyết vấn đề: subclass phá vỡ contract của parent một cách silent
- **ISP** giải quyết vấn đề: caller phụ thuộc vào contract chứa những gì nó không cần
- **DIP** giải quyết vấn đề: business logic bị khóa chặt vào một infrastructure cụ thể

Tất cả đều giải quyết vấn đề thay đổi — thay đổi requirement, thay đổi infrastructure, thay đổi behavior. Nhưng nếu code của mày không có pressure thay đổi — áp dụng SOLID sớm không làm code tốt hơn. Nó làm code phức tạp hơn không cần thiết.

---

## Ví dụ — áp dụng SOLID quá sớm

Đây là một feature đơn giản: tính tổng tiền của một appointment bao gồm phí khám và phụ phí:

```java
// Feature mới, requirement chưa rõ, chỉ cần chạy trước
@Service
public class AppointmentBillingService {
    
    public BigDecimal calculateTotal(Appointment appointment) {
        BigDecimal consultationFee = appointment.getDoctor().getConsultationFee();
        BigDecimal surcharge = appointment.getDepartment().getSurcharge();
        return consultationFee.add(surcharge);
    }
}
```

Mày đọc xong OCP và nghĩ: *"Sau này có thể có nhiều loại fee khác nhau — mình nên dùng Strategy pattern ngay."*

Kết quả:

```java
// ❌ Vấn đề — over-engineering cho một bài toán chưa có evidence là cần mở rộng
public interface FeeCalculationStrategy {
    BigDecimal calculate(Appointment appointment);
}

@Component
public class ConsultationFeeStrategy implements FeeCalculationStrategy {
    @Override
    public BigDecimal calculate(Appointment appointment) {
        return appointment.getDoctor().getConsultationFee();
    }
}

@Component
public class SurchargeFeeStrategy implements FeeCalculationStrategy {
    @Override
    public BigDecimal calculate(Appointment appointment) {
        return appointment.getDepartment().getSurcharge();
    }
}

@Component
public class TotalFeeAggregator {
    private final List<FeeCalculationStrategy> strategies;
    
    public BigDecimal calculateTotal(Appointment appointment) {
        return strategies.stream()
            .map(s -> s.calculate(appointment))
            .reduce(BigDecimal.ZERO, BigDecimal::add);
    }
}
```

Bây giờ để hiểu "tính tổng tiền là gì", mày phải trace qua bốn file. Mày tạo ra abstraction layer cho một bài toán chưa có evidence là sẽ cần mở rộng. Nếu requirement thật sự đơn giản — hai dòng code ban đầu là đủ.

---

## Dấu hiệu SOLID đang bị over-applied

**Abstraction không có "why":** Mày tạo `interface AppointmentNotifier` nhưng chỉ có một implementation và không có kế hoạch nào cho implementation thứ hai. Interface đó không giải quyết vấn đề gì hiện tại — nó chỉ thêm indirection.

**Class quá nhỏ, tên quá chung chung:** `AppointmentValidator`, `AppointmentCreator`, `AppointmentSaver`, `AppointmentMapper` — tất cả đều là class riêng, nhưng không cái nào có đủ behavior để justify sự tồn tại của mình. SRP không có nghĩa là một class chỉ được có một method.

**Interface bị create trước khi có vấn đề:** Mày tạo `interface ScheduleRepository` với một method `findAvailable()`, chỉ có một implementation là JPA, không có kế hoạch swap. DIP có giá trị khi mày thật sự cần tách business logic khỏi infrastructure detail — không phải khi mày wrap JPA chỉ để có một interface.

**Mỗi lần đọc code phải nhảy qua quá nhiều file:** Nếu để trace một request từ controller đến database, mày phải mở hơn mười file — SOLID có thể đã được áp dụng theo cách làm tăng complexity thay vì giảm.

---

## Rule of Three — khi nào thì refactor theo SOLID

Có một heuristic thực tế: **đừng generalize cho đến khi mày thấy pattern xuất hiện ít nhất ba lần.**

Sprint 1: HMS có payment tiền mặt. Không cần interface, không cần Strategy.

Sprint 3: Thêm VNPay. Bây giờ có hai loại. Vẫn có thể giữ đơn giản — một `if/else` không phải tội lỗi.

Sprint 6: Thêm Momo. Ba loại. *Bây giờ* mày có evidence rằng payment methods sẽ tiếp tục tăng. *Bây giờ* mới là lúc refactor theo OCP với Strategy pattern.

Áp dụng pattern từ Sprint 1 dựa trên "có thể sau này cần" là speculation. Refactor ở Sprint 6 dựa trên evidence thực tế là engineering.

---

## SOLID và trade-off thực sự

Có một tension ít người nói đến: đôi khi áp dụng một nguyên tắc SOLID vi phạm nguyên tắc khác.

**SRP vs. Cohesion:** Tách `AppointmentService` thành `AppointmentBookingService`, `AppointmentQueryService`, `AppointmentCancellationService` theo SRP — nhưng nếu ba cái đó thường được dùng cùng nhau, mày đã split cohesive code. Caller giờ phải inject ba service thay vì một.

**OCP vs. YAGNI:** Thiết kế "open for extension" cho mọi thứ dẫn đến abstraction layer không cần thiết. "You Ain't Gonna Need It" — đừng thiết kế cho requirement chưa tồn tại.

**DIP vs. Simplicity:** Wrap mọi infrastructure call sau interface dẫn đến code có nhiều indirection hơn cần thiết. Đôi khi, một repository JPA đơn giản là đủ — không cần một custom interface ở trên nó.

---

## Cách nghĩ đúng về SOLID

SOLID không phải checklist. Nó là bộ công cụ để chẩn đoán và giải quyết một loại đau cụ thể:

- Code cứng, khó thay đổi → SRP và OCP
- Kế thừa tạo ra bug silent → LSP
- Test setup quá nặng → ISP
- Business logic bị khóa vào infrastructure → DIP

Khi mày thấy đau, nhìn vào bộ công cụ và chọn cái phù hợp. Đừng dùng toàn bộ bộ công cụ trước khi mày biết mình đang đau gì.

---

## Takeaway

SOLID không phải mục tiêu — **changeability** mới là mục tiêu. SOLID là một bộ nguyên tắc giúp đạt được điều đó. Khi mày áp dụng bất kỳ nguyên tắc nào, hỏi: *"Tao đang giải quyết vấn đề gì cụ thể? Vấn đề đó đã tồn tại chưa, hay tao đang giải quyết vấn đề tưởng tượng?"* Nếu là tưởng tượng — giữ code đơn giản. Refactor khi vấn đề thật sự xuất hiện.

---

*Bài tiếp theo: Design Pattern không giúp mày viết code tốt hơn — nếu mày dùng nó sai*
