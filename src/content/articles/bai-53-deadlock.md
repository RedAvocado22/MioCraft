---
title: "Deadlock — vì sao database tự kill query của mày"
description: "Deadlock xảy ra khi hai transaction chờ nhau giải phóng lock. Database phát hiện và kill một transaction — nhưng fix đúng cách mới tránh được tái diễn."
category: system-design
pubDate: 2024-02-22
series: "Phần 6: Database"
tags: ["database", "deadlock", "transactions"]
---

Mày viết một transaction. Nó chạy ổn lúc test. Lên production, user thấy error: "Deadlock found when trying to get lock". Application crash, user chịu.

Deadlock là khi hai transaction cùng cần nhau để tiếp tục, nhưng cả hai đều giữ cái gì đó mà cái kia cần. MySQL phải kill một trong hai để thoát vòng lặp vô hạn.

Cách tránh deadlock không phải viết query phức tạp hơn — là hiểu khi nào nó xảy ra, và structure transaction để nó không xảy ra.

---

## Deadlock xảy ra khi nào?

Giả sử mày có hai resource: Row A và Row B.

```
Transaction 1:
  Lock Row A
  Wait for Row B

Transaction 2:
  Lock Row B
  Wait for Row A

Vòng lặp vô hạn. MySQL không thể thoát.
```

MySQL quyết định: "Tao kill transaction 2, rollback, transaction 1 lấy Row B, xong."

---

## Ví dụ thực tế — Transfer tiền từ account A sang B

Giả sử mày implement transfer như này:

```java
@Transactional
public void transfer(UUID fromId, UUID toId, BigDecimal amount) {
    Account from = accountRepo.findById(fromId).lock(); // SELECT FOR UPDATE
    from.setBalance(from.getBalance() - amount);
    accountRepo.save(from);
    
    Account to = accountRepo.findById(toId).lock(); // SELECT FOR UPDATE
    to.setBalance(to.getBalance() + amount);
    accountRepo.save(to);
}
```

Khi mày transfer 1000 từ Account A → B, và đồng thời user khác transfer 2000 từ B → A:

```
Transaction 1: transfer(A → B, 1000)
  Time 1: Lock A
  Time 2: Try lock B → WAIT (B đang locked)

Transaction 2: transfer(B → A, 2000)
  Time 2: Lock B
  Time 3: Try lock A → WAIT (A đang locked)

Deadlock. MySQL kill transaction 2.
```

---

## Cách tránh deadlock

**Rule 1 — Lock order phải consistent**

Lúc nào cũng lock A trước B. Không bao giờ lock B trước A. Nếu mỗi transaction lock cùng order, sẽ không có circular wait.

```java
@Transactional
public void transfer(UUID id1, UUID id2, BigDecimal amount) {
    // Luôn lock theo thứ tự ID nhỏ hơn trước
    UUID fromId = id1.compareTo(id2) < 0 ? id1 : id2;
    UUID toId = id1.compareTo(id2) < 0 ? id2 : id1;
    
    Account from = accountRepo.findById(fromId).lock();
    Account to = accountRepo.findById(toId).lock();
    
    // ... logic transfer
}
```

Giờ mọi transaction lock A → B, không bao giờ B → A. Vòng lặp không thể xảy ra.

**Rule 2 — Minimize lock scope**

Lock chỉ cái cần thiết, release ngay lập tức.

```java
// ❌ Xấu — lock A, làm những việc không liên quan, rồi mới lock B
Account a = repo.findById(aId).lock();
sendEmail(a.getEmail()); // Tại sao lock A suốt lúc gửi email?
Account b = repo.findById(bId).lock();
```

```java
// ✅ Tốt — lock, làm, unlock, rồi lock cái khác
Account a = repo.findById(aId).lock();
a.setBalance(...);
repo.save(a);
// a auto-unlocked tại end of transaction (hoặc early unlock nếu framework support)

Account b = repo.findById(bId).lock();
b.setBalance(...);
repo.save(b);
```

**Rule 3 — Tránh nested locks**

```java
// ❌ Xấu
@Transactional
public void complexOp(UUID aId) {
    Account a = repo.findById(aId).lock(); // Lock A
    updateDependentData(a); // Function này làm gì? Có lock khác không?
}

private void updateDependentData(Account a) {
    // Nếu function này gọi lock B, rồi lock A từ đâu khác, deadlock.
}
```

```java
// ✅ Tốt
@Transactional
public void complexOp(UUID aId) {
    Account a = repo.findById(aId).lock();
    // Nằm trong transaction hiện tại, clear scope là cái nào lock
}
```

**Rule 4 — Retry logic**

Dù cậu làm sao, deadlock vẫn có thể happen (ví dụ do timing không may). Cách lành mạnh là retry:

```java
public void transferWithRetry(UUID fromId, UUID toId, BigDecimal amount) {
    int maxRetries = 3;
    for (int i = 0; i < maxRetries; i++) {
        try {
            transfer(fromId, toId, amount);
            return;
        } catch (DataIntegrityViolationException e) {
            if (e.getCause() instanceof SQLException &&
                ((SQLException) e.getCause()).getErrorCode() == 1213) {
                // 1213 = MySQL deadlock error code
                if (i == maxRetries - 1) throw e;
                Thread.sleep(100 * (long) Math.pow(2, i)); // Exponential backoff
            } else {
                throw e;
            }
        }
    }
}
```

---

## Cách detect deadlock

MySQL log nó vào error log:

```
2025-01-15 10:23:45 [ERROR] InnoDB: Deadlock found when trying to get lock...
*** (1) TRANSACTION:
TRANSACTION 100, ACTIVE 0 sec, process no 1234, OS thread id 5678
...
*** (2) TRANSACTION:
TRANSACTION 101, ACTIVE 0 sec, process no 1235, OS thread id 5679
...
```

Hoặc từ application, exception:

```java
catch (DataIntegrityViolationException e) {
    Throwable cause = e.getCause();
    if (cause instanceof SQLException) {
        SQLException se = (SQLException) cause;
        if (se.getErrorCode() == 1213) {
            // Deadlock
        }
    }
}
```

---

## Ví dụ HMS — appointment booking với payment

```java
@Transactional(isolation = Isolation.REPEATABLE_READ)
public void bookAppointmentWithPayment(UUID scheduleId, UUID patientId) {
    // Lock order: scheduleId < patientId (consistent order)
    if (scheduleId.compareTo(patientId) > 0) {
        UUID temp = scheduleId;
        scheduleId = patientId;
        patientId = scheduleId;
    }
    
    DoctorSchedule schedule = scheduleRepo.findById(scheduleId).lock();
    if (schedule.getAvailableSlots() <= 0) {
        throw new BusinessException("No slots");
    }
    schedule.setAvailableSlots(schedule.getAvailableSlots() - 1);
    scheduleRepo.save(schedule);
    
    Patient patient = patientRepo.findById(patientId).lock();
    patient.setLastAppointmentTime(LocalDateTime.now());
    patientRepo.save(patient);
    
    Appointment appointment = new Appointment(schedule, patient);
    appointmentRepo.save(appointment);
}
```

Lock order: schedule → patient (ID nhỏ hơn lock trước). Mỗi transaction follow quy tắc này → No deadlock.

---

## Takeaway

Deadlock không phải bug của MySQL, là transaction design của mày. Quy tắc đơn giản: lock cùng order, lock minimal scope, retry if happen.

---

*Bài tiếp theo: N+1 Query — bug thầm lặng giết performance từ từ*
