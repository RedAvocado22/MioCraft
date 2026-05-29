---
title: "Pagination — offset vs cursor, và tại sao page 500 chậm hơn page 1 đến 500 lần"
description: "LIMIT/OFFSET đơn giản nhưng chậm khi offset lớn. Cursor pagination nhanh hơn nhưng không nhảy trang được. Trade-off và cách implement cả hai trong Spring Data."
category: system-design
pubDate: 2024-04-18
series: "Phần 6: Database"
tags: ["database", "pagination", "performance", "spring-data"]
---

---

API của mày có endpoint lấy danh sách appointments. Mày implement pagination bằng `LIMIT` và `OFFSET` vì đó là cái đầu tiên hiện ra khi Google "Spring Boot pagination". Mọi thứ hoạt động bình thường trong development, test pass, deploy lên production.

Sáu tháng sau, hệ thống có vài triệu records. Một admin mở trang 500 của danh sách — và phải chờ 8 giây.

Không phải vì máy chủ yếu. Không phải vì network chậm. Mà vì `OFFSET` có một vấn đề căn bản mà không ai nói với mày khi mày mới học.

---

## OFFSET hoạt động như thế nào thật sự

Mày nghĩ `OFFSET 5000 LIMIT 20` nghĩa là "nhảy thẳng đến row 5000 rồi lấy 20 row". Thực tế không phải vậy.

Database phải **đọc và đếm toàn bộ 5000 rows đầu tiên**, rồi bỏ chúng đi, rồi mới trả về 20 rows tiếp theo. Không có shortcut nào ở đây — ngay cả khi có index, database vẫn phải traverse qua 5000 entries đó.

```sql
-- Mày tưởng đây là O(1) — nhảy thẳng đến offset
SELECT * FROM appointments
ORDER BY created_at DESC
LIMIT 20 OFFSET 5000;

-- Thực tế đây là O(offset) — đọc 5020 rows, trả về 20, bỏ 5000
```

Trang 1: đọc 20 rows. Trang 251: đọc 5020 rows. Trang 501: đọc 10020 rows. Performance degradation tuyến tính theo số trang.

---

## Cursor-based pagination giải quyết vấn đề này như thế nào

Thay vì nói "bỏ qua N rows đầu", cursor-based pagination nói: "cho tao những rows có giá trị lớn hơn giá trị cuối cùng tao đã thấy".

```java
// ❌ Offset-based — chậm dần theo số trang
public Page<AppointmentResponse> getAppointments(int page, int size) {
    Pageable pageable = PageRequest.of(page, size, Sort.by("createdAt").descending());
    return appointmentRepository.findAll(pageable).map(mapper::toResponse);
}

// ✅ Cursor-based — O(log n) bất kể mày đang ở trang nào
public CursorPage<AppointmentResponse> getAppointments(String cursor, int size) {
    LocalDateTime cursorTime = cursor != null 
        ? decodeCursor(cursor) 
        : LocalDateTime.now();
    
    List<Appointment> results = appointmentRepository
        .findByCreatedAtBeforeOrderByCreatedAtDesc(cursorTime, PageRequest.of(0, size + 1));
    
    boolean hasNext = results.size() > size;
    List<Appointment> pageData = hasNext ? results.subList(0, size) : results;
    
    String nextCursor = hasNext 
        ? encodeCursor(pageData.get(pageData.size() - 1).getCreatedAt())
        : null;
    
    return new CursorPage<>(pageData.stream().map(mapper::toResponse).toList(), nextCursor);
}
```

Query tương ứng:

```sql
-- Cursor-based — database dùng index trực tiếp, không scan từ đầu
SELECT * FROM appointments
WHERE created_at < '2024-01-15 10:30:00'
ORDER BY created_at DESC
LIMIT 21;
```

Với index trên `created_at`, query này luôn là O(log n) bất kể mày đang ở "trang" bao nhiêu. Database nhảy thẳng đến vị trí cần thiết trong index tree.

---

## Trade-offs: cái gì tốt hơn phụ thuộc vào use case

Cursor-based không phải lúc nào cũng đúng. Đây là khi nào nên dùng cái gì:

**Dùng Offset-based khi:**
- User cần nhảy đến trang cụ thể ("trang 47 trong 200 trang")
- Data set nhỏ và không scale lên
- Cần hiển thị "trang X / Y tổng số trang"
- Admin panel với số lượng records cố định

**Dùng Cursor-based khi:**
- Infinite scroll — social feed, notification list, appointment history
- Data set lớn và tiếp tục tăng
- Không cần nhảy đến trang cụ thể
- Real-time data thay đổi thường xuyên (offset có vấn đề với data mới insert giữa chừng)

Trong HMS, danh sách appointments của patient (infinite scroll trong app) dùng cursor. Báo cáo admin cần nhảy trang dùng offset với giới hạn số lượng records hợp lý.

---

## Vấn đề ít ai nhắc: offset với data thay đổi

Có một bug tinh tế với offset mà user thường than nhưng dev không hiểu tại sao: duplicate records hoặc missing records khi paginate.

```
User xem trang 1: records [A, B, C, D, E]
Trong lúc đó, record F được insert vào đầu danh sách
User chuyển sang trang 2: records [E, F, G, H, I]  ← E bị duplicate
```

Record `E` bị đọc hai lần vì offset 5 giờ trỏ đến vị trí khác với trước. Cursor-based không có vấn đề này vì mày track bằng giá trị thực, không phải vị trí.

---

## Implement Response đúng cách

```java
// Response structure cho cursor-based pagination
public record CursorPage<T>(
    List<T> data,
    String nextCursor,      // null nếu không còn trang tiếp
    boolean hasNext
) {}

// Client decode và dùng nextCursor cho request tiếp theo
// GET /api/appointments?cursor=eyJjcmVhdGVkQXQiOiIyMDI0LTAxLTE1VDEwOjMwOjAwIn0
```

Encode cursor thành base64 hoặc opaque string — client không cần biết bên trong là gì. Nếu mai mày đổi cách implement cursor, client không bị ảnh hưởng.

---

## Takeaway

Offset pagination là thứ dạy cho mày để mày hiểu concept — không phải để mày dùng trong production với data set lớn. Trước khi implement pagination, hỏi hai câu: *"Data set này sẽ lớn đến đâu?"* và *"User có cần nhảy đến trang cụ thể không?"* Hai câu trả lời đó quyết định mày dùng gì.

---

*Bài tiếp theo: JWT là gì và tại sao token không phải session — stateless authentication và cái giá phải trả.*
