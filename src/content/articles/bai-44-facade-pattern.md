---
title: "Facade — tại sao KeycloakService tồn tại thay vì gọi thẳng"
description: "Facade đơn giản hóa interface phức tạp. Thay vì để mọi nơi gọi Keycloak SDK trực tiếp — một Facade che đi sự phức tạp và là điểm thay đổi duy nhất."
category: programming
pubDate: 2024-02-13
series: "Phần 5: Design Patterns"
tags: ["design-patterns", "facade", "abstraction"]
---

Khi HMS cần tạo một user mới trong Keycloak, flow không đơn giản chỉ là một API call. Bạn cần: lấy admin token, tạo user với thông tin cơ bản, gán role, set temporary password, rồi handle từng loại lỗi khác nhau cho từng bước. Nếu bước nào fail — cần rollback hoặc cleanup những gì đã làm trước đó.

Nếu bạn để hết logic đó trực tiếp trong `PatientService` hay `EmployeeService` — những service cần tạo Keycloak account — bạn vừa làm hỏng hai thứ cùng lúc: service chính bị ô nhiễm bởi Keycloak implementation details, và logic Keycloak bị duplicate ở nhiều chỗ.

Đó là lý do `KeycloakService` — hay nói chính xác hơn, `KeycloakFacade` — tồn tại.

---

## Facade là gì

Facade là pattern đơn giản nhất trong số các structural pattern. Ý tưởng: tạo một class với interface đơn giản, che đi sự phức tạp của một subsystem bên dưới.

Caller không cần biết subsystem gồm bao nhiêu bước, bao nhiêu API call, bao nhiêu edge case. Họ chỉ cần biết: *"Tôi gọi method này với input này, tôi nhận được kết quả này."*

```java
// ❌ Không có Facade — PatientService phải biết tất cả về Keycloak
@Service
public class PatientService {
    
    public Patient registerPatient(PatientRegistrationRequest request) {
        // Business logic của Patient
        Patient patient = patientMapper.toEntity(request);
        patient = patientRepository.save(patient);
        
        // Bắt đầu phần Keycloak — tại sao PatientService phải biết những thứ này?
        String adminToken = keycloakAdminClient.obtainAccessToken().getToken();
        
        UserRepresentation user = new UserRepresentation();
        user.setUsername(request.getEmail());
        user.setEmail(request.getEmail());
        user.setEnabled(true);
        
        Response response = keycloakAdminClient.realm("hms")
            .users()
            .create(user);
        
        if (response.getStatus() != 201) {
            // Phải rollback patient vừa save
            patientRepository.delete(patient);
            throw new KeycloakUserCreationException("Failed to create Keycloak user");
        }
        
        String userId = extractUserId(response);
        
        // Gán role
        RoleRepresentation role = keycloakAdminClient.realm("hms")
            .roles()
            .get("PATIENT")
            .toRepresentation();
        keycloakAdminClient.realm("hms")
            .users()
            .get(userId)
            .roles()
            .realmLevel()
            .add(List.of(role));
        
        // ...và còn nhiều bước nữa
        
        return patient;
    }
}
```

Đây là service đang làm quá nhiều việc. Khi Keycloak thay đổi API, khi cần thêm bước mới vào flow tạo user — bạn phải tìm và sửa ở mọi nơi PatientService, DoctorService, EmployeeService, v.v.

---

## Với Facade

```java
// Facade: che giấu complexity của Keycloak
@Service
public class KeycloakUserFacade {
    
    /**
     * Tạo user trong Keycloak với role và password.
     * Nếu bất kỳ bước nào fail, tự động cleanup và throw exception.
     */
    public String createUser(String email, String roleName, String temporaryPassword) {
        String userId = null;
        try {
            userId = createKeycloakUser(email);
            assignRole(userId, roleName);
            setTemporaryPassword(userId, temporaryPassword);
            return userId;
        } catch (Exception e) {
            // Nếu fail ở bước nào, cleanup những gì đã tạo
            if (userId != null) {
                silentlyDeleteUser(userId);
            }
            throw new KeycloakOperationException("Failed to create user: " + email, e);
        }
    }
    
    public void deleteUser(String keycloakUserId) {
        // Logic xóa user với error handling
        try {
            usersResource(keycloakUserId).remove();
        } catch (NotFoundException e) {
            // User không tồn tại — không phải lỗi nghiêm trọng, log và tiếp tục
            log.warn("Attempted to delete non-existent Keycloak user: {}", keycloakUserId);
        }
    }
    
    public void updateUserStatus(String keycloakUserId, boolean enabled) {
        UserRepresentation user = usersResource(keycloakUserId).toRepresentation();
        user.setEnabled(enabled);
        usersResource(keycloakUserId).update(user);
    }
    
    // Private methods xử lý từng bước — Facade không expose những thứ này
    private String createKeycloakUser(String email) { ... }
    private void assignRole(String userId, String roleName) { ... }
    private void setTemporaryPassword(String userId, String password) { ... }
    private void silentlyDeleteUser(String userId) { ... }
    private UserResource usersResource(String userId) { ... }
}
```

Bây giờ PatientService trở thành:

```java
@Service
public class PatientService {
    
    @Transactional
    public Patient registerPatient(PatientRegistrationRequest request) {
        Patient patient = patientMapper.toEntity(request);
        patient = patientRepository.save(patient);
        
        // PatientService không cần biết Keycloak hoạt động thế nào
        String keycloakId = keycloakUserFacade.createUser(
            request.getEmail(), 
            "PATIENT", 
            passwordGenerator.generate()
        );
        
        patient.setKeycloakId(keycloakId);
        return patient;
    }
}
```

---

## Facade không phải chỉ cho external systems

Facade hữu ích bất cứ khi nào bạn có một nhóm operations liên quan đến nhau mà caller không nên phải orchestrate từng bước.

Trong HMS: một `AppointmentFacade` có thể gom lại các bước book appointment — kiểm tra slot, tạo appointment record, giữ slot trong Redis, gửi confirmation — vào một method duy nhất. Thay vì caller phải gọi 4 service theo thứ tự đúng.

---

## Khi nào không dùng

Facade không phải garbage bin. Nếu bạn nhét mọi thứ vào một class và gọi nó là Facade, bạn đang tạo ra một God Object.

Dấu hiệu Facade đang sai chỗ: class có quá nhiều responsibility không liên quan đến nhau, hoặc bạn thấy mình cần inject 10 dependency vào nó. Facade nên cover một subsystem cụ thể — không phải toàn bộ ứng dụng.

---

## Takeaway

Nhìn lại HMS — có service nào đang phải biết quá nhiều về implementation details của một hệ thống ngoài (Keycloak, Redis, external API) không? Đó là ứng viên để extract ra một Facade. Mục tiêu: business service chỉ nói *"làm việc này"*, không cần biết *"làm thế nào"*.

---

*Bài tiếp theo: Decorator — kế thừa không sai, sai là bạn dùng nó để mở rộng hành vi*
