---
title: "Kiến trúc thường chết vì con người, không phải vì code"
description: "Kiến trúc đẹp trên giấy thường sụp đổ trong thực tế vì team không hiểu nó, không theo nó, hoặc không có ai enforce nó."
category: architecture
pubDate: 2024-02-01
series: "Phần 3: Kiến trúc phần mềm"
tags: ["architecture", "team", "engineering-culture"]
---

Bạn có thể thiết kế kiến trúc hoàn hảo trên giấy — boundary rõ ràng, dependency đúng hướng, domain logic tách khỏi infrastructure. Rồi sáu tháng sau, codebase trông y hệt như trước khi bạn refactor. Không phải vì kiến trúc sai. Mà vì không ai trong team thực sự follow nó.

Đây là vấn đề mà hầu hết bài viết về kiến trúc không đả động đến: **kiến trúc là thỏa thuận xã hội, không phải thứ compiler enforce.**

---

## Tại sao kiến trúc tốt chết trẻ

Xét một scenario thực tế: team quyết định domain object không được biết về JPA, tất cả persistence đi qua Store interface. Quyết định đúng, được document, được review.

Ba tuần sau, một developer mới join. Deadline gấp. Họ cần thêm một query phức tạp vào `Appointment`. Cách nhanh nhất: inject `AppointmentRepository` trực tiếp vào một service, query JPA specification luôn. Không ai review kỹ vì PR nhỏ và feature cần xong hôm nay.

Một tuần sau, developer khác thấy pattern đó trong codebase và nghĩ "à, cách này team dùng." Copy paste vào chỗ khác.

Sau một tháng, có năm nơi trong codebase inject repository trực tiếp vào domain-adjacent code. Boundary đã bị break — không phải một lần có chủ đích, mà từng chút từng chút qua những quyết định tưởng chừng vô hại.

---

## Ba nguyên nhân kiến trúc không survive

**Nguyên nhân 1: Kiến trúc chỉ tồn tại trong đầu người thiết kế.**

Nếu architectural decision không được viết ra — tại sao làm vậy, đánh đổi gì, không được làm gì — nó sẽ chết cùng với người hiểu nó. Người mới join không có context, họ làm theo những gì họ thấy trong code, không phải những gì được nghĩ đến khi thiết kế.

**Nguyên nhân 2: Không có cơ chế enforce.**

"Mọi người nhớ không?" không phải enforce. Verbal agreement không phải enforce. Cái duy nhất thật sự enforce là tooling — package structure mà compiler không cho import chéo, ArchUnit test check dependency rules, code review checklist với specific questions về boundary.

**Nguyên nhân 3: Con đường lười nhất dẫn đến vi phạm kiến trúc.**

Khi deadline gấp, developer sẽ chọn con đường ít kháng cự nhất. Nếu vi phạm kiến trúc là cách dễ nhất để làm xong task — họ sẽ vi phạm, dù không có ý định xấu. Thiết kế tốt cần làm cho con đường đúng là con đường dễ nhất, không phải khó nhất.

---

## Architecture Decision Records — documentation thực sự có ích

ADR là một document ngắn (một đến hai trang) ghi lại một architectural decision quan trọng: bối cảnh là gì, options nào được xem xét, quyết định là gì và tại sao, hậu quả là gì.

```markdown
# ADR-003: Domain Objects không depend on JPA

## Status: Accepted

## Context
Khi HMS scale lên, chúng ta cần khả năng test business logic nhanh
mà không cần boot Spring context. JPA annotation trong domain objects
tạo ra coupling không cần thiết.

## Decision
- Domain objects (trong package `domain/`) không import bất kỳ thứ gì
  từ `javax.persistence`, `jakarta.persistence`, hoặc Spring Data.
- JPA mapping thực hiện qua separate `*JpaEntity` class.
- Conversion giữa domain và JPA entity qua mapper.

## Consequences
(+) Domain logic testable không cần Spring context
(+) Schema change không affect domain object
(-) Thêm code mapping — accepted trade-off
(-) Thêm class cần maintain

## Non-compliance
Mọi PR vi phạm rule này cần justification rõ ràng trong PR description.
ArchUnit test trong `ArchitectureTest.java` sẽ fail nếu vi phạm.
```

Một file như vậy trong repo `docs/adr/` làm được hai thứ: developer mới hiểu tại sao code được tổ chức như vậy thay vì chỉ thấy code, và quyết định được revisit khi context thay đổi thay vì bị follow mù quáng.

---

## ArchUnit — enforce architecture bằng test

Verbal agreement không scale. Test thì scale:

```java
@AnalyzeClasses(packages = "com.hms")
class ArchitectureTest {

    @ArchTest
    ArchRule domainShouldNotDependOnJpa = noClasses()
        .that().resideInAPackage("..domain..")
        .should().dependOnClassesThat()
        .resideInAnyPackage("javax.persistence..", "jakarta.persistence..", "org.springframework.data..");

    @ArchTest
    ArchRule controllersShouldNotAccessRepository = noClasses()
        .that().resideInAPackage("..controller..")
        .should().dependOnClassesThat()
        .resideInAPackage("..repository..");

    @ArchTest
    ArchRule useCasesShouldNotDependOnEachOther = noClasses()
        .that().resideInAPackage("..usecase..")
        .should().dependOnClassesThat()
        .resideInAPackage("..usecase..");
}
```

Những test này chạy trong CI. Khi ai đó vi phạm architectural rule, build fail — không phải sau khi merge, không phải khi người có kinh nghiệm review, mà ngay lập tức. Không cần ai "nhớ" rule. Cơ chế enforce tự động.

---

## Kiến trúc là văn hóa trước khi là code

Cuối cùng, kiến trúc tốt không phải chỉ là những diagram đẹp hay pattern đúng. Nó là thứ team đồng ý làm và thực sự làm mỗi ngày — khi không có người có kinh nghiệm watch, khi deadline gấp, khi cách dễ nhất là vi phạm rule.

Điều đó đòi hỏi: document rõ ràng để mọi người hiểu *tại sao*, tooling để enforce thay vì dựa vào memory, và culture code review thực sự hỏi về boundary và design — không chỉ check logic.

---

## Takeaway

Sau khi thiết kế hoặc refactor một architectural rule, hỏi: *"Nếu một developer mới join hôm nay mà không ai giải thích gì, họ có làm đúng không? Và nếu họ làm sai, hệ thống có tự phát hiện không?"* Nếu câu trả lời là không — rule đó chưa thật sự được enforce.

---

*Bài tiếp theo: SOLID — code chạy được vẫn fail vì bạn chưa hiểu cái này*
