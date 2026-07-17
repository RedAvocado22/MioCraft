---
title: "File upload đúng cách — multipart, base64, và S3 presigned URL"
description: "Ảnh X-quang 15MB không nên base64 qua JSON. Multipart cho upload vừa, presigned URL cho file lớn — backend không làm proxy băng thông."
category: system-design
pubDate: 2026-05-29
series: "Phần 10: Case Studies thực tế"
tags: ["case-study", "file-upload", "S3", "spring-boot"]
---


Bác sĩ upload ảnh chụp X-quang gắn vào `MedicalRecord`. Frontend convert file sang base64, nhét vào JSON:

```json
{
  "patientId": "...",
  "imageBase64": "/9j/4AAQSkZJRg... (15 triệu ký tự)"
}
```

Request 20MB. Gateway timeout. Tomcat `maxPostSize` explode. DB column `LONGTEXT` phình to. Backup chậm. Bạn tăng timeout lên 120 giây — hệ thống không crash nhưng **architecture đã sai**.

File binary không thuộc JSON body. Có ba pattern đúng tùy scale.

---

## Multipart/form-data — upload vừa qua API

Browser và Spring xử lý native:

```java
@PostMapping(value = "/medical-records/{id}/attachments", consumes = MediaType.MULTIPART_FORM_DATA_VALUE)
@PreAuthorize("hasRole('DOCTOR')")
public AttachmentResponse upload(
    @PathVariable UUID id,
    @RequestPart("file") MultipartFile file,
    @RequestPart(value = "metadata", required = false) AttachmentMetadata metadata) {

  if (file.getSize() > MAX_SIZE_BYTES) {
    throw new BadRequestException("FILE_TOO_LARGE");
  }
  if (!ALLOWED_MIME.contains(file.getContentType())) {
    throw new BadRequestException("INVALID_FILE_TYPE");
  }

  return attachmentService.store(id, file.getInputStream(), file.getOriginalFilename(), file.getContentType());
}
```

```yaml
spring:
  servlet:
    multipart:
      max-file-size: 10MB
      max-request-size: 12MB
```

**Ưu:** Đơn giản, một request, dễ validate auth JWT trước khi nhận bytes.  
**Nhược:** File đi qua app server — RAM/disk spike khi nhiều upload đồng thời. Giới hạn ~10–50MB thực tế.

`MultipartFile` — đừng gọi `file.getBytes()` load hết RAM với file lớn; stream:

```java
public AttachmentResponse store(UUID recordId, InputStream input, String filename, String contentType) {
  String key = "medical-records/%s/%s".formatted(recordId, UUID.randomUUID() + sanitize(filename));
  s3Client.putObject(PutObjectRequest.builder()
      .bucket(bucket)
      .key(key)
      .contentType(contentType)
      .build(),
      RequestBody.fromInputStream(input, contentLength)); // stream thẳng lên S3
  return attachmentRepository.save(new Attachment(recordId, key, contentType));
}
```

---

## Base64 trong JSON — khi nào không nên

Base64 tăng size ~33%. 10MB file → 13MB JSON → parse JSON tốn CPU và memory gấp đôi feeling.

Chỉ chấp nhận được cho **payload rất nhỏ**: chữ ký số vài KB, thumbnail. X-quang, PDF lab result — **không**.

Nếu mobile app "tiện" gửi base64 — đổi sang multipart hoặc presigned URL.

---

## Presigned URL — file lớn, upload thẳng S3

Flow:

```
1. Client: POST /api/medical-records/{id}/attachments/presign
           { "filename": "xray.dcm", "contentType": "application/dicom", "size": 15728640 }
2. Server: validate quyền, size, MIME → trả presigned PUT URL + attachmentId tạm
3. Client: PUT file thẳng lên S3 (không qua backend)
4. Client: POST /api/.../attachments/{attachmentId}/complete
5. Server: verify object tồn tại S3, finalize DB record
```

```java
public PresignResponse createPresignedUpload(UUID recordId, PresignRequest req) {
  validateDoctorCanAccess(recordId);
  if (req.size() > MAX_SIZE_BYTES) throw new BadRequestException("FILE_TOO_LARGE");

  UUID attachmentId = UUID.randomUUID();
  String key = "medical-records/%s/%s".formatted(recordId, attachmentId);

  PutObjectRequest objectRequest = PutObjectRequest.builder()
      .bucket(bucket)
      .key(key)
      .contentType(req.contentType())
      .contentLength(req.size())
      .build();

  PutObjectPresignRequest presignRequest = PutObjectPresignRequest.builder()
      .signatureDuration(Duration.ofMinutes(15))
      .putObjectRequest(objectRequest)
      .build();

  URL presignedUrl = s3Presigner.presignPutObject(presignRequest).url();

  attachmentRepository.save(Attachment.pending(recordId, attachmentId, key));
  return new PresignResponse(attachmentId, presignedUrl.toString());
}
```

**Ưu:** Backend không mang 15MB × 100 concurrent uploads. Scale S3.  
**Nhược:** Flow 2 bước, client phải handle PUT fail, complete callback.

TTL presign 5–15 phút. Key prefix theo `recordId` — không cho client chọn path tùy ý.

---

## Bảo mật không chỉ upload

- **MIME sniff** — đừng tin extension `.jpg` alone; check magic bytes hoặc allowlist
- **Virus scan** — queue scan sau upload complete (ClamAV, cloud scanner) trước khi doctor khác download
- **Download** — không public S3 bucket; presigned GET hoặc proxy có auth + audit log (ai xem X-quang ai)
- **PHI** — medical imaging là protected health information; encryption at rest (S3 SSE), TLS in transit

```java
@GetMapping("/attachments/{id}/download")
public ResponseEntity<Void> download(@PathVariable UUID id) {
  var attachment = attachmentService.getAuthorized(id); // ABAC
  URL url = s3Presigner.presignGetObject(...); // TTL ngắn
  return ResponseEntity.status(HttpStatus.FOUND).location(url.toURI()).build();
}
```

---

## So sánh nhanh

| Cách | Kích thước | Backend load | Độ phức tạp |
|------|------------|--------------|-------------|
| JSON base64 | Chỉ rất nhỏ | Cao | Thấp (nhưng sai) |
| Multipart | ~10–50MB | Trung bình | Thấp |
| Presigned S3 | Lớn (GB) | Thấp | Trung bình |

HMS: ảnh đính kèm thường multipart hoặc presign; DICOM/archive lớn — presigned bắt buộc.

---

## Takeaway

File là binary stream, không phải string trong JSON. Multipart + stream lên S3 cho upload vừa. Presigned URL khi file lớn hoặc traffic cao — backend chỉ ký URL, không ôm bytes. Và trước khi bạn base64 hóa X-quang — hãy tính 33% overhead cộng gateway timeout; có lẽ đó là lý do người có kinh nghiệm reject PR.

---

*Bài tiếp theo: Search trong HMS — LIKE, FULLTEXT, và Elasticsearch.*
