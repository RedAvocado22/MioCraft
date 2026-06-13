---
title: "Composite — khi cây và lá phải được xử lý như nhau"
description: "GoF gặp cấu trúc dạng cây — menu có submenu, category có subcategory, permission có group. Composite cho phép xử lý một node đơn hay toàn bộ cây bằng cùng một cách."
category: programming
pubDate: 2026-07-26
series: "Phần 5: Design Patterns thực chiến"
tags: ["composite", "design-pattern", "tree-structure", "java"]
---

HMS có permission system. Bác sĩ được xem `MedicalRecord` của bệnh nhân trong phòng mình. Trưởng khoa được xem toàn bộ record của khoa đó. Admin được xem tất cả.

Ban đầu mày check permission bằng role — đơn giản, đủ dùng. Rồi requirement thay đổi: một bác sĩ có thể được grant thêm permission vào một số record cụ thể ngoài phạm vi phòng của họ. Permission giờ là tổ hợp: role-based *cộng với* specific grants.

Mày viết:

```java
// ❌ Caller phải biết cấu trúc bên trong
public boolean canAccess(User user, MedicalRecord record) {
    if (hasRolePermission(user.getRole(), record)) return true;
    if (hasSpecificGrant(user.getId(), record.getId())) return true;
    if (user.getDepartmentId() != null
        && isDepartmentHead(user)
        && record.getDepartmentId().equals(user.getDepartmentId())) return true;
    return false;
}
```

Mỗi loại permission mới là một `if` mới vào method này. Không scale.

---

## Vấn đề GoF thấy

Cấu trúc dạng cây có đặc tính: **một node có thể là leaf (không có children) hoặc composite (có children).** Khi mày muốn “evaluate toàn bộ cây”, mày phải xử lý leaf và composite khác nhau — hoặc là mày tìm ra cách làm cho chúng giống nhau.

GoF giải bằng cách cho leaf và composite implement cùng một interface. Composite đệ quy gọi xuống children của nó. Caller không cần biết đang xử lý leaf hay cả cây — gọi cùng một method.

---

## Áp dụng vào HMS permission system

Đầu tiên, interface chung — cả leaf lẫn composite đều implement cái này:

```java
public interface PermissionRule {
    boolean permits(User user, MedicalRecord record);
}
```

Ba leaf — mỗi cái là một loại check độc lập:

```java
// Leaf 1: check theo role
public class RolePermissionRule implements PermissionRule {
    private final Set<Role> allowedRoles;

    public RolePermissionRule(Set<Role> allowedRoles) {
        this.allowedRoles = allowedRoles;
    }

    @Override
    public boolean permits(User user, MedicalRecord record) {
        return allowedRoles.contains(user.getRole());
    }
}

// Leaf 2: check xem có được grant trực tiếp không
public class SpecificGrantRule implements PermissionRule {
    private final GrantRepository grantRepo;

    @Override
    public boolean permits(User user, MedicalRecord record) {
        return grantRepo.existsByUserIdAndRecordId(user.getId(), record.getId());
    }
}

// Leaf 3: trưởng khoa xem được record của khoa mình
public class DepartmentHeadRule implements PermissionRule {
    @Override
    public boolean permits(User user, MedicalRecord record) {
        return user.isDepartmentHead()
            && user.getDepartmentId() != null
            && user.getDepartmentId().equals(record.getDepartmentId());
    }
}
```

Hai composite — cũng implement cùng interface đó, nhưng thay vì tự check, chúng hỏi xuống children:

```java
// Composite OR — bất kỳ rule nào pass là đủ
public class AnyOfPermissionRule implements PermissionRule {
    private final List<PermissionRule> rules;

    public AnyOfPermissionRule(List<PermissionRule> rules) {
        this.rules = rules;
    }

    @Override
    public boolean permits(User user, MedicalRecord record) {
        // gọi đệ quy xuống — không quan tâm children là leaf hay composite khác
        return rules.stream().anyMatch(rule -> rule.permits(user, record));
    }
}

// Composite AND — tất cả phải pass
public class AllOfPermissionRule implements PermissionRule {
    private final List<PermissionRule> rules;

    public AllOfPermissionRule(List<PermissionRule> rules) {
        this.rules = rules;
    }

    @Override
    public boolean permits(User user, MedicalRecord record) {
        return rules.stream().allMatch(rule -> rule.permits(user, record));
    }
}
```

Lắp lại thành cây — bác sĩ xem được record nếu thoả bất kỳ điều kiện nào:

```java
PermissionRule medicalRecordRule = new AnyOfPermissionRule(List.of(
    new RolePermissionRule(Set.of(Role.DOCTOR, Role.NURSE)), // có role phù hợp
    new SpecificGrantRule(grantRepository),                   // hoặc được grant trực tiếp
    new DepartmentHeadRule()                                  // hoặc là trưởng khoa
));

// Caller gọi một dòng — không biết bên trong là cây hay leaf đơn
boolean allowed = medicalRecordRule.permits(currentUser, record);
```

Thêm loại permission mới? Tạo class mới implement `PermissionRule`, thêm vào `List.of(...)`. Không sửa gì khác. Cần logic phức tạp hơn — “phải có role đúng VÀ phải đang trong ca trực”? Lồng composite:

```java
PermissionRule complex = new AnyOfPermissionRule(List.of(
    new AllOfPermissionRule(List.of(hasCorrectRole, isOnDuty)), // bác sĩ đang trực
    new SpecificGrantRule(grantRepository)                       // hoặc được grant đặc biệt
));
```

Caller vẫn gọi `.permits()` — không biết bên trong có bao nhiêu tầng.

---

## Khi nào Composite quá tay

Composite phù hợp khi **cấu trúc thật sự có dạng cây** và **logic đệ quy là tự nhiên**. Đừng dùng nó khi:

Mày chỉ có 2–3 loại rule cố định không bao giờ thay đổi. `if/else` hay `switch` đọc thẳng hơn, ít code hơn, không cần thiết kế thêm class hierarchy.

Cấu trúc flat — không có khái niệm “rule chứa rule”. Composite tỏa sáng với cây, không phải với danh sách.

Khi mày nhận ra mình đang viết Composite chỉ vì nó “có vẻ đúng pattern” nhưng caller không bao giờ cần đệ quy — đó là dấu hiệu cần đơn giản hóa.

---

## Takeaway

Composite là pattern của cây: khi leaf và branch cần được xử lý đồng nhất, khi logic cần đệ quy xuống children mà không quan tâm depth. Trong HMS, nó giải bài “permission phức tạp tổ hợp từ nhiều rule” sạch hơn nhiều so với chuỗi `if`. Nhưng nếu mày không có cấu trúc cây thật sự, đừng tạo ra nó chỉ để dùng Composite.

---

*Bài tiếp theo: Chain of Responsibility — khi request phải đi qua nhiều handler*