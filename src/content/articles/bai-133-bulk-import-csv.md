---
title: "Bulk import CSV bệnh nhân — batch, validation, không dừng cả file"
description: "Import 10k dòng: chunk size, validate từng row, gom lỗi trả report — một dòng sai không rollback cả file."
category: system-design
pubDate: 2026-06-03
series: "Phần 10: Case Studies thực tế"
tags: ["case-study", "import", "csv", "batch", "validation"]
---

Phòng khám chuyển từ Excel sang HMS. File CSV 8.432 bệnh nhân. Lần đầu dev viết: đọc hết → `saveAll()` một transaction → dòng 4.201 thiếu SĐT → **rollback toàn bộ**. Admin gọi: *“Sao không import được 8.431 người còn lại?”*

Bulk import production không phải “upload = một transaction khổng lồ”.

---

## Mục tiêu: partial success có kiểm soát

| Cách | Hệ quả |
|------|--------|
| Một `@Transactional` cho cả file | Một lỗi → zero row persist |
| Từng row transaction riêng | Chậm hơn nhưng row tốt vẫn lưu |
| Validate hết trước, không ghi | Admin sửa file, import lại — OK cho lần đầu |

HMS chọn: **validate từng row + persist row hợp lệ + file báo cáo lỗi** (row number, field, message).

---

## Parse và batch size

Đừng load 50MB vào RAM một lần nếu không cần. Đọc stream, gom **batch** (vd 100–500 row) gọi `saveAll` — cân bằng memory và round-trip DB.

```java
@Service
@RequiredArgsConstructor
public class PatientBulkImportService {

  private static final int BATCH_SIZE = 200;

  private final PatientRepository patientRepository;
  private final Validator validator;

  public ImportResult importCsv(InputStream csvStream) {
    List<RowError> errors = new ArrayList<>();
    List<Patient> batch = new ArrayList<>();
    int rowNum = 0;
    int successCount = 0;

    try (CSVReader reader = new CSVReaderBuilder(new InputStreamReader(csvStream))
        .withSkipLines(1) // header
        .build()) {

      String[] line;
      while ((line = reader.readNext()) != null) {
        rowNum++;
        Optional<PatientImportRow> parsed = parseRow(line, rowNum, errors);
        if (parsed.isEmpty()) continue;

        PatientImportRow row = parsed.get();
        Set<ConstraintViolation<PatientImportRow>> violations = validator.validate(row);
        if (!violations.isEmpty()) {
          violations.forEach(v -> errors.add(new RowError(rowNum, v.getPropertyPath().toString(), v.getMessage())));
          continue;
        }

        batch.add(mapper.toEntity(row));
        if (batch.size() >= BATCH_SIZE) {
          successCount += flushBatch(batch, errors, rowNum - batch.size() + 1);
          batch.clear();
        }
      }
      if (!batch.isEmpty()) {
        successCount += flushBatch(batch, errors, rowNum - batch.size() + 1);
      }
    } catch (IOException e) {
      throw new ImportFailedException("Cannot read CSV", e);
    }

    return new ImportResult(successCount, errors);
  }

  // Mỗi batch transaction ngắn — fail một row trong batch có thể tách nhỏ hơn nếu cần
  @Transactional
  protected int flushBatch(List<Patient> batch, List<RowError> errors, int startRow) {
    int saved = 0;
    for (int i = 0; i < batch.size(); i++) {
      try {
        patientRepository.save(batch.get(i));
        saved++;
      } catch (DataIntegrityViolationException e) {
        errors.add(new RowError(startRow + i, "patientCode", "Duplicate or invalid FK"));
      }
    }
    return saved;
  }
}
```

`BATCH_SIZE` 200 là điểm khởi đầu — đo trên staging với index thật. Quá lớn: lock lâu. Quá nhỏ: chậm.

---

## Validation từng row — trước khi chạm DB

- Format: email, phone VN, ngày sinh `dd/MM/yyyy`
- Business: `patientCode` unique trong file (Set trong memory) và trong DB
- FK: `clinicId` tồn tại

Lỗi format → không `save`, chỉ ghi `RowError`. Tránh dùng exception flow control cho từng cell — chậm và log noise.

---

## Error report cho admin

Response (hoặc file tải về) dạng:

```json
{
  "imported": 8100,
  "failed": 332,
  "errors": [
    { "row": 42, "field": "phone", "message": "must not be blank" },
    { "row": 4201, "field": "patientCode", "message": "Duplicate in database" }
  ]
}
```

Optional: CSV `errors.csv` mirror row lỗi để sửa và import lại **chỉ phần fail**.

Job lớn (>50k): đẩy queue (bài 65), trả `jobId`, poll status — HTTP không giữ connection 20 phút.

---

## Takeaway

Import CSV HMS: stream + batch, validate per row, transaction theo batch hoặc row — không một transaction cho cả file. Trả báo cáo lỗi có số dòng để admin sửa được, không chỉ “Import failed”.

---

*Bài tiếp theo: Notification preferences — opt-out và unsubscribe*
