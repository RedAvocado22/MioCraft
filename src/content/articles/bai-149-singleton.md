---
title: "Singleton — pattern dễ nhất, bị dùng sai nhiều nhất"
description: "GoF tạo ra Singleton để giải quyết một vấn đề cụ thể. Vấn đề bắt đầu khi một pattern bị dùng để giải quyết mọi thứ."
category: programming
pubDate: 2026-06-28
series: "Phần 5: Design Patterns"
tags: ["singleton", "design-pattern", "spring", "dependency-injection"]
---

Nếu bạn hỏi một người mới "kể tên design pattern bạn biết", câu trả lời đầu tiên gần như chắc chắn là Singleton. Nó được dạy đầu tiên, hiểu nhanh nhất, và bị dùng sai nhiều nhất.

---

## GoF gặp vấn đề gì

1994. Bốn tác giả cuốn *Design Patterns* đang làm việc với C++ và Smalltalk — không có framework, không có DI container. Nếu bạn cần một object đại diện cho database connection pool, config loader, hay logger, bạn phải tự quản lý lifecycle của nó.

Vấn đề: không có gì ngăn đồng nghiệp của bạn tạo `new DatabasePool()` ở năm chỗ khác nhau. Năm pool, năm connection set, resource bị đốt không cần thiết.

Singleton sinh ra để giải bài đó: **đảm bảo chỉ có một instance của một class tồn tại trong toàn bộ chương trình, và cung cấp một điểm truy cập global vào nó.**

```java
// Cái GoF viết ra — đúng với bối cảnh C++ 1994
public class DatabasePool {
    private static DatabasePool instance;

    private DatabasePool() { /* private constructor */ }

    public static synchronized DatabasePool getInstance() {
        if (instance == null) {
            instance = new DatabasePool();
        }
        return instance;
    }
}
```

Ý tưởng không tệ — trong thế giới không có DI framework.

---

## Tại sao nó trở thành anti-pattern

Vấn đề không phải là "chỉ một instance". Vấn đề là **global state với static accessor**.

Khi bạn gọi `DatabasePool.getInstance()` trong `AppointmentService`, bạn đang hard-wire một dependency vào bên trong class. Không có interface. Không có cách inject một mock vào. Test viết không được — hoặc viết được nhưng phải dùng reflection để reset cái `instance` về `null` giữa các test.

Hơn nữa, Singleton truyền thống có threading issue. `synchronized` trên `getInstance()` đúng nhưng expensive. Double-checked locking phức tạp và dễ sai trước Java 5. Enum-based Singleton (Joshua Bloch gợi ý trong *Effective Java*) là cách an toàn nhất nếu bạn thật sự cần viết tay — nhưng câu hỏi vẫn là: bạn có thật sự cần không?

---

## Spring đã giải bài này rồi

Năm 2026, nếu bạn đang dùng Spring Boot, bạn đang sống trong một DI container. Mọi `@Service`, `@Repository`, `@Component` mặc định là **singleton scope** — Spring tạo một instance, giữ nó trong ApplicationContext, và inject nó vào bất kỳ chỗ nào yêu cầu.

```java
// ✅ Đây là Singleton trong Spring — không cần viết một dòng Singleton code
@Service
public class AppointmentService {
    // Spring đảm bảo chỉ có một instance của class này
    // trong toàn bộ application context
}
```

Bạn không cần `static getInstance()`. Bạn không cần `private constructor`. Spring lo hết.

Và vì dependency được inject qua constructor, test trở nên thẳng thắn:

```java
// ✅ Test dễ vì không có global state
@Test
void shouldReturnAvailableSchedules() {
    var mockRepo = mock(AppointmentRepository.class);
    var service = new AppointmentService(mockRepo); // inject mock thoải mái
    // ...
}
```

So với:

```java
// ❌ Test nightmare — global state, không inject được
@Test
void shouldReturnAvailableSchedules() {
    var service = AppointmentService.getInstance(); // gọi static
    // mock cái gì bây giờ? reset state thế nào giữa các test?
}
```

---

## Khi nào Singleton pattern vẫn còn nghĩa

Có một số ít trường hợp bạn viết Singleton tay là hợp lý — thường là ngoài Spring context:

**Command-line tool không dùng Spring:** bạn build một CLI parser nhỏ, không cần DI framework. Một config loader singleton có thể hợp lý.

**Enum constant:** nếu bạn cần một tập cố định các object với behavior (không phải chỉ giá trị), enum-based singleton vẫn là idiom sạch trong Java.

**Static utility class:** nếu class không có state và chỉ chứa pure function, `static` method là đủ — không cần cả Singleton lẫn Spring bean.

Còn lại — nếu bạn đang viết Spring Boot và đang nghĩ đến Singleton: dừng lại. Câu hỏi đúng không phải "viết Singleton thế nào?" mà là "mình có cần `@Singleton` scope không, hay `@Service` default đã đủ?"

---

## Takeaway

Singleton là pattern đơn giản nhất trong GoF, và bài học từ nó cũng đơn giản: **pattern sinh ra để giải một vấn đề cụ thể trong một bối cảnh cụ thể**. Khi framework của bạn đã giải bài đó rồi, dùng lại pattern đó là mang problem vào thay vì giải problem.

---

*Bài tiếp theo: Factory — khi bạn không muốn code biết nó đang tạo ra object gì*
