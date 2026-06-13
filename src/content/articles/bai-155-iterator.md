---
title: "Iterator — duyệt collection mà không cần biết bên trong có gì"
description: "GoF gặp bài toán: cùng một traversal logic phải chạy trên array, linked list, tree, graph — mà không thay đổi code duyệt. Iterator tách 'cách duyệt' ra khỏi 'cấu trúc chứa data'. Java đã bake nó vào ngôn ngữ."
category: programming
pubDate: 2026-08-09
series: "Phần 5: Design Patterns thực chiến"
tags: ["iterator", "design-pattern", "java", "collections"]
---

Có một pattern mà mày đang dùng mỗi lần viết `for (Appointment apt : appointments)` mà không biết tên của nó.

---

## GoF giải bài gì

1994, codebase mày làm việc có thể lưu data trong `Array`, `LinkedList`, `BinaryTree`, `HashTable`. Mỗi cấu trúc duyệt theo cách khác nhau — array dùng index, linked list dùng `next`, tree dùng đệ quy.

Nếu business logic phải biết đang duyệt cấu trúc nào để chọn cách duyệt phù hợp, code trở nên coupled với implementation detail của collection. Đổi từ `Array` sang `LinkedList` là phải sửa tất cả chỗ dùng nó.

GoF giải: **tách traversal algorithm ra khỏi collection object**. Mỗi collection cung cấp một `Iterator` object biết cách duyệt chính nó. Caller chỉ dùng `Iterator`, không cần biết collection là gì.

```
Collection → tạo ra → Iterator
Caller → chỉ nói chuyện với → Iterator
```

---

## Java đã build Iterator vào ngôn ngữ

Java 1.2 (1998) implement Iterator pattern trực tiếp vào Collections API:

```java
// java.util.Iterator — GoF pattern thành ngôn ngữ
public interface Iterator<E> {
    boolean hasNext();
    E next();
    default void remove() { throw new UnsupportedOperationException(); }
}

// java.lang.Iterable — collection có thể tạo Iterator
public interface Iterable<T> {
    Iterator<T> iterator();
}
```

Mỗi lần mày viết `for-each loop`, Java compiler dịch nó thành:

```java
// Mày viết
for (Appointment apt : appointments) {
    process(apt);
}

// Compiler dịch ra
Iterator<Appointment> iter = appointments.iterator();
while (iter.hasNext()) {
    Appointment apt = iter.next();
    process(apt);
}
```

`appointments` có thể là `ArrayList`, `LinkedHashSet`, `PriorityQueue`, hay bất kỳ custom collection nào implement `Iterable` — code duyệt không thay đổi gì.

---

## Khi nào mày tự implement Iterator

Tự viết Iterator hữu ích khi mày có cấu trúc data tùy chỉnh cần được duyệt theo nhiều cách.

HMS có `DoctorSchedule` — lịch của bác sĩ theo tuần, lưu dạng tree với nhánh là ngày và lá là time slot. Mày cần duyệt theo hai cách: theo ngày (tất cả slot của thứ Hai, rồi thứ Ba...) và theo slot trống (chỉ những slot chưa đầy, bỏ qua ngày).

```java
public class WeeklySchedule implements Iterable<DoctorSchedule> {

    private final Map<DayOfWeek, List<DoctorSchedule>> scheduleByDay;

    // Duyệt tuần tự theo ngày — default iterator
    @Override
    public Iterator<DoctorSchedule> iterator() {
        return scheduleByDay.values().stream()
            .flatMap(List::stream)
            .iterator();
    }

    // Iterator thứ hai — chỉ slot còn trống
    public Iterator<DoctorSchedule> availableSlotsIterator() {
        return scheduleByDay.values().stream()
            .flatMap(List::stream)
            .filter(DoctorSchedule::hasAvailableSlots)
            .iterator();
    }
}
```

Caller:

```java
WeeklySchedule schedule = // ...

// Duyệt tất cả slot
for (DoctorSchedule slot : schedule) {
    displaySlot(slot);
}

// Duyệt chỉ slot trống
Iterator<DoctorSchedule> available = schedule.availableSlotsIterator();
while (available.hasNext()) {
    suggestToPatient(available.next());
}
```

Cấu trúc bên trong `WeeklySchedule` có thể đổi từ `Map` sang bất kỳ gì — caller không đổi gì.

---

## Stream API: Iterator tiến hóa

Java 8 thêm `Stream` — về bản chất là Iterator với superpowers: lazy evaluation, parallel processing, và một bộ operation phong phú (`map`, `filter`, `reduce`...).

```java
// Iterator style — verbose
Iterator<DoctorSchedule> iter = schedules.iterator();
List<DoctorScheduleResponse> result = new ArrayList<>();
while (iter.hasNext()) {
    DoctorSchedule s = iter.next();
    if (s.hasAvailableSlots()) {
        result.add(mapper.toResponse(s));
    }
}

// Stream style — declarative, đọc như ngôn ngữ tự nhiên
List<DoctorScheduleResponse> result = schedules.stream()
    .filter(DoctorSchedule::hasAvailableSlots)
    .map(mapper::toResponse)
    .toList();
```

Trong modern Java, `Stream` thường thay thế manual `Iterator` cho processing pipeline. Iterator tường minh vẫn cần thiết khi mày cần kiểm soát tinh từng bước — ví dụ, pause giữa chừng, interleave với external system call, hoặc batch-process từng N element.

---

## Một dạng Iterator quan trọng: database cursor

Pagination trong HMS không load toàn bộ `List<Appointment>` rồi duyệt — đó là cách đốt memory khi có hàng triệu record. Cursor-based pagination là Iterator pattern ở tầng database:

```java
// Duyệt từng batch thay vì load hết vào memory
@Transactional(readOnly = true)
public void exportAllAppointments(OutputStream out) {
    try (Stream<Appointment> cursor = appointmentRepository.streamAll()) {
        // Spring Data dùng ScrollQuery hoặc @QueryHints để giữ cursor mở
        cursor
            .map(csvMapper::toCsvRow)
            .forEach(row -> writeLine(out, row));
    }
}
```

`streamAll()` dùng JDBC cursor — database không dump hết record một lần mà gửi từng batch khi caller gọi `next()`. Đây là Iterator pattern xuyên qua network connection.

---

## Khi nào không cần nghĩ đến Iterator

Trong code Java hàng ngày với Spring Boot, mày hiếm khi cần "implement Iterator pattern" vì nó đã ở khắp nơi rồi — `List`, `Set`, `Stream`, JPA repository method trả `List` hoặc `Stream`, tất cả đều là Iterator pattern sẵn.

Mày chỉ cần chủ động nghĩ đến nó khi xây dựng custom data structure, khi cần multiple traversal strategy trên cùng một structure, hoặc khi xử lý data quá lớn để load hết vào memory.

---

## Takeaway

Iterator là một trong những pattern đã được bake vào DNA của Java đến mức mày dùng nó mà không nhận ra. Hiểu nó giúp mày viết custom collection đúng (`implement Iterable`), chọn đúng giữa `Iterator`, `for-each`, và `Stream` cho từng use case, và hiểu tại sao database cursor pagination lại quan trọng khi dataset lớn.

---

*Bài tiếp theo: Visitor — khi mày cần thêm operation vào object hierarchy mà không sửa class*
