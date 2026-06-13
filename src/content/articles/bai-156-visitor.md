---
title: "Visitor — khi mày cần thêm operation vào object hierarchy mà không sửa class"
description: "GoF gặp một mâu thuẫn kinh điển: thêm operation mới mà không sửa class cũ, hoặc thêm class mới mà không sửa operation cũ — mày chỉ được chọn một. Visitor giải nửa bài đó."
category: programming
pubDate: 2026-08-16
series: "Phần 5: Design Patterns thực chiến"
tags: ["visitor", "design-pattern", "double-dispatch", "java"]
---

Visitor là pattern khó nhất trong batch này để giải thích — không phải vì implementation phức tạp, mà vì pain point nó giải quyết không hiển nhiên cho đến khi mày gặp nó.

Để hiểu Visitor, mày cần hiểu một mâu thuẫn trước.

---

## The Expression Problem — mâu thuẫn mà Visitor giải một nửa

HMS có document system: bệnh nhân ký các loại document khác nhau — `ConsentForm`, `InsuranceClaim`, `ReferralLetter`. Mỗi loại là một class riêng.

Mày cần thực hiện nhiều operation trên những document này: render ra PDF, export ra JSON cho HL7 FHIR, validate theo từng loại, tính fee.

Cách thứ nhất: đặt tất cả operation vào class hierarchy.

```java
public interface MedicalDocument {
    byte[] toPdf();
    String toFhirJson();
    ValidationResult validate();
    BigDecimal calculateFee();
}
```

Thêm document mới (`SurgicalConsent`)? Implement interface — dễ, chỉ sửa một class mới. Thêm operation mới (`toHL7v2()`)? Sửa interface + sửa TẤT CẢ class đang implement — đau.

Cách thứ hai: đặt operation bên ngoài, switch theo type.

```java
public class DocumentPdfRenderer {
    public byte[] render(MedicalDocument doc) {
        if (doc instanceof ConsentForm f) return renderConsentForm(f);
        if (doc instanceof InsuranceClaim c) return renderInsuranceClaim(c);
        if (doc instanceof ReferralLetter r) return renderReferralLetter(r);
        throw new IllegalArgumentException("Unknown document type");
    }
}
```

Thêm operation mới? Tạo class mới — dễ. Thêm document mới? Sửa TẤT CẢ class operation — đau.

Đây là *Expression Problem*: mày chỉ được chọn một chiều để extend dễ. Visitor chọn chiều “thêm operation dễ” — trả giá bằng “thêm class khó hơn”.

---

## Visitor: đưa dispatch về đúng chỗ

Vấn đề với `instanceof` chain: Java không tự biết gọi đúng `render` method cho đúng document type — mày phải hỏi thủ công. Visitor dùng *double dispatch* để làm điều đó tự động.

```java
// Document interface: chỉ có một method — accept visitor
public interface MedicalDocument {
    void accept(DocumentVisitor visitor);
}

// Mỗi document class implement accept bằng cách gọi đúng method trên visitor
public class ConsentForm implements MedicalDocument {
    private final String patientName;
    private final LocalDate signedAt;
    // ...

    @Override
    public void accept(DocumentVisitor visitor) {
        visitor.visit(this); // "this" là ConsentForm — Java biết đúng overload
    }
}

public class InsuranceClaim implements MedicalDocument {
    private final String claimId;
    private final BigDecimal claimedAmount;
    // ...

    @Override
    public void accept(DocumentVisitor visitor) {
        visitor.visit(this); // "this" là InsuranceClaim
    }
}

public class ReferralLetter implements MedicalDocument {
    @Override
    public void accept(DocumentVisitor visitor) {
        visitor.visit(this);
    }
}
```

Visitor interface — có một `visit` overload cho mỗi document type:

```java
public interface DocumentVisitor {
    void visit(ConsentForm form);
    void visit(InsuranceClaim claim);
    void visit(ReferralLetter letter);
}
```

Mỗi operation là một class implement `DocumentVisitor`:

```java
public class PdfRenderer implements DocumentVisitor {
    private byte[] result;

    @Override
    public void visit(ConsentForm form) {
        // render consent form specific layout
        result = renderConsentFormPdf(form.getPatientName(), form.getSignedAt());
    }

    @Override
    public void visit(InsuranceClaim claim) {
        // insurance claim có layout hoàn toàn khác
        result = renderInsuranceClaimPdf(claim.getClaimId(), claim.getClaimedAmount());
    }

    @Override
    public void visit(ReferralLetter letter) {
        result = renderReferralLetterPdf(/* ... */);
    }

    public byte[] getResult() { return result; }
}

public class FhirJsonExporter implements DocumentVisitor {
    private String jsonResult;

    @Override
    public void visit(ConsentForm form) {
        jsonResult = buildConsentFormFhir(form);
    }

    @Override
    public void visit(InsuranceClaim claim) {
        jsonResult = buildClaimFhir(claim);
    }

    @Override
    public void visit(ReferralLetter letter) {
        jsonResult = buildReferralFhir(letter);
    }

    public String getResult() { return jsonResult; }
}
```

Sử dụng:

```java
MedicalDocument doc = getDocumentById(id); // không biết type cụ thể

PdfRenderer renderer = new PdfRenderer();
doc.accept(renderer);                       // double dispatch: doc biết type của nó, gọi đúng visit()
byte[] pdf = renderer.getResult();

FhirJsonExporter exporter = new FhirJsonExporter();
doc.accept(exporter);
String fhir = exporter.getResult();
```

Thêm operation mới `HL7v2Exporter`? Tạo class mới implement `DocumentVisitor` — không sửa gì cả trong document classes.

---

## Tại sao phải đi vòng qua `accept`?

Mày nhìn vào code trên và thắc mắc: tại sao không gọi thẳng `visitor.visit(doc)` mà phải đi vòng `doc.accept(visitor)`?

Thử gọi thẳng xem:

```java
MedicalDocument doc = getDocumentById(id); // type thật là ConsentForm, nhưng Java chỉ biết là MedicalDocument

visitor.visit(doc); // ❌ compile error — không có overload visit(MedicalDocument)
```

Java không có overload `visit(MedicalDocument)`. Mày phải cast:

```java
if (doc instanceof ConsentForm f)    visitor.visit(f);
else if (doc instanceof InsuranceClaim c) visitor.visit(c);
// ...
```

Và đây chính xác là cái `instanceof` chain mày muốn thoát khỏi từ đầu bài.

Vấn đề nằm ở cách Java chọn overload: quyết định được đưa ra lúc **compile time**, dựa trên type được khai báo của biến — không phải type thật lúc runtime. `doc` được khai báo là `MedicalDocument`, nên Java không biết gọi `visit(ConsentForm)` hay `visit(InsuranceClaim)`.

Visitor giải bằng cách thêm một bước nhảy: thay vì để caller quyết định, **để object tự gọi đúng overload cho chính nó**. Bên trong `accept`, `this` là type cụ thể — Java biết chắc đây là `ConsentForm`, không phải interface. Nên `visitor.visit(this)` gọi đúng overload `visit(ConsentForm)`.

```
doc.accept(visitor)
  → ConsentForm.accept(visitor)        // dispatch lần 1: theo type của doc
    → visitor.visit(this)              // dispatch lần 2: theo type của this = ConsentForm
      → PdfRenderer.visit(ConsentForm) // ✅ đúng overload
```

Hai lần dispatch — đó là “double dispatch”. Pattern này workaround một limitation của Java: không có multiple dispatch built-in.

Java sealed class + pattern matching (từ Java 17+) là alternative hiện đại:

```java
// Java 17+ — không cần Visitor pattern cho nhiều case
public byte[] renderPdf(MedicalDocument doc) {
    return switch (doc) {
        case ConsentForm f    -> renderConsentFormPdf(f);
        case InsuranceClaim c -> renderInsuranceClaimPdf(c);
        case ReferralLetter r -> renderReferralLetterPdf(r);
    };
}
```

Sealed class đảm bảo `switch` phải exhaustive — compiler báo lỗi nếu mày thêm document type mà quên update switch. Nhiều trường hợp trước đây cần Visitor, sealed class + pattern matching giải gọn hơn.

---

## Khi nào không dùng Visitor

Visitor là pattern cồng kềnh — hierarchy document phải biết về `DocumentVisitor`, mỗi document phải implement `accept`. Đổi lại, thêm operation không cần sửa document class.

Đừng dùng khi:

Mày hay thêm document type mới hơn operation mới — mỗi lần thêm type là phải sửa tất cả Visitor implementation. Đảo chiều: nếu type hierarchy ổn định nhưng operation hay thêm, Visitor phù hợp.

Mày đang dùng Java 17+ và sealed class giải bài tốt hơn với ít code hơn.

Hierarchy chỉ có 2–3 type và logic không phức tạp — `instanceof` pattern matching đọc thẳng hơn.

---

## Takeaway

Visitor giải một bài rất cụ thể: type hierarchy ổn định, nhưng operation hay thêm mới, và mày không muốn sửa toàn bộ class mỗi lần thêm operation. Nếu mày đang maintain một đống `instanceof` chain hay `switch (type)` phân tán khắp codebase, Visitor gom logic operation vào một chỗ. Nếu mày đang dùng Java 17+, sealed class + pattern matching là lựa chọn thường clean hơn cho bài tương tự.

---

*Bài tiếp theo: Khi nào design pattern là cái bẫy — tổng kết những gì GoF không nói*