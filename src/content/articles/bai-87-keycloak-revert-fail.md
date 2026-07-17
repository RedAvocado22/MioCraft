---
title: "Keycloak revert fail — compensation pattern và cái giá của distributed state"
description: "Tạo user trong DB thành công, tạo user trong Keycloak thất bại — hệ thống ở trạng thái inconsistent. Saga pattern và compensation transaction là cách xử lý distributed failure."
category: system-design
pubDate: 2024-03-28
series: "Phần 10: Case Studies thực tế"
tags: ["case-study", "saga-pattern", "Keycloak", "distributed-systems"]
---

Register một user mới trong HMS cần hai thứ xảy ra: một record trong database nội bộ (thông tin bệnh nhân, medical history, etc.) và một account trong Keycloak (authentication, JWT issuance). Hai hệ thống. Hai operations. Không có distributed transaction nào bao phủ cả hai.

Khi Keycloak call thành công nhưng DB insert fail — hoặc ngược lại — bạn có một user tồn tại ở một nơi nhưng không có ở nơi kia. Hệ thống ở trạng thái inconsistent. Và đây là trạng thái rất khó phục hồi nếu bạn không chuẩn bị trước.

---

## Vấn đề của two-phase commit trong thực tế

Câu trả lời lý thuyết cho distributed consistency là two-phase commit (2PC): một coordinator hỏi tất cả participants "bạn có sẵn sàng commit không?", tất cả đồng ý, rồi coordinator ra lệnh commit. Nếu ai không đồng ý, tất cả rollback.

Thực tế: Keycloak không support 2PC. REST API không support 2PC. Hầu hết external services không support 2PC. Bạn không thể wrap HTTP call và database insert vào cùng một distributed transaction.

Và ngay cả khi có thể, 2PC có vấn đề riêng: nó chặn resources trong quá trình coordinate, dễ deadlock, và khi coordinator crash thì hệ thống bị stuck.

Thứ bạn thực sự cần là **compensation** — thay vì "rollback cùng nhau", là "nếu bước N fail, undo bước N-1, N-2, ... theo thứ tự ngược lại."

---

## Compensation pattern: undo theo thứ tự ngược

```java
@Service
@RequiredArgsConstructor
public class UserRegistrationService {

    private final PatientRepository patientRepository;
    private final KeycloakService keycloakService;

    public PatientRegistrationResponse registerPatient(PatientRegistrationRequest request) {
        // Bước 1: Tạo record trong DB của chúng ta
        // Làm điều này trước vì rollback DB dễ hơn rollback Keycloak
        Patient patient = patientMapper.toEntity(request);
        patient = patientRepository.save(patient);
        final UUID patientId = patient.getId();

        // Bước 2: Tạo account trên Keycloak
        // Đây là external call — có thể fail
        String keycloakUserId;
        try {
            keycloakUserId = keycloakService.createUser(
                request.getEmail(),
                request.getPassword(),
                patient.getId()
            );
        } catch (KeycloakException e) {
            // Keycloak fail → compensation: xóa DB record vừa tạo
            log.error("Keycloak user creation failed for patient {}, rolling back DB record", patientId);
            patientRepository.deleteById(patientId);
            throw new RegistrationException("Failed to create authentication account", e);
        }

        // Bước 3: Update DB record với Keycloak ID
        try {
            patient.setKeycloakId(keycloakUserId);
            patient = patientRepository.save(patient);
        } catch (Exception e) {
            // DB update fail → compensation: xóa Keycloak user vừa tạo + xóa DB record
            log.error("Failed to link Keycloak ID to patient {}, compensating", patientId);
            safelyDeleteKeycloakUser(keycloakUserId, patientId);
            patientRepository.deleteById(patientId);
            throw new RegistrationException("Failed to complete registration", e);
        }

        return patientMapper.toRegistrationResponse(patient);
    }

    private void safelyDeleteKeycloakUser(String keycloakUserId, UUID patientId) {
        try {
            keycloakService.deleteUser(keycloakUserId);
        } catch (Exception compensationException) {
            // Compensation itself failed — đây là trường hợp tệ nhất
            // Log đầy đủ thông tin để ops team có thể manual cleanup
            log.error(
                "CRITICAL: Compensation failed! Keycloak user {} for patient {} needs manual cleanup. Error: {}",
                keycloakUserId, patientId, compensationException.getMessage()
            );
            // Đừng suppress exception gốc — throw compensation failure riêng
            // hoặc dùng monitoring alert để ops team biết cần intervene
        }
    }
}
```

---

## Compensation fail là trường hợp thực sự nguy hiểm

Code ở trên có một vấn đề: `safelyDeleteKeycloakUser` có thể fail. Keycloak có thể down. Network timeout. Rate limit. Compensation bản thân là một operation có thể fail.

Khi compensation fail, bạn có một "orphaned resource" — user tồn tại trong Keycloak nhưng không có record tương ứng trong DB (hoặc ngược lại). Không có cách nào để tự động clean up.

HMS xử lý điều này bằng cách kết hợp hai thứ:

**Thứ nhất:** Saga pattern với persistent state — mỗi bước của registration flow được ghi lại vào DB. Nếu process bị interrupt, một background job có thể detect và tiếp tục compensation.

```java
@Entity
@Table(name = "registration_sagas")
public class RegistrationSaga {
    @Id
    private UUID id;

    private UUID patientId;
    private String keycloakUserId; // null nếu chưa tạo

    @Enumerated(EnumType.STRING)
    private SagaStatus status; // PATIENT_CREATED, KEYCLOAK_CREATED, COMPLETED, COMPENSATING, FAILED

    private Instant createdAt;
    private Instant updatedAt;
    private int compensationAttempts;
}
```

```java
@Scheduled(fixedDelay = 60_000)
public void cleanupOrphanedRegistrations() {
    // Tìm những saga bị stuck ở trạng thái intermediate quá 10 phút
    List<RegistrationSaga> staleSagas = registrationSagaRepository
        .findByStatusInAndUpdatedAtBefore(
            List.of(SagaStatus.PATIENT_CREATED, SagaStatus.COMPENSATING),
            Instant.now().minus(10, ChronoUnit.MINUTES)
        );

    for (RegistrationSaga saga : staleSagas) {
        attemptCompensation(saga);
    }
}
```

**Thứ hai:** Dead letter queue cho những trường hợp không thể tự động recover — các saga này cần manual intervention, và ops team cần được alert.

---

## Một cách nhìn khác: đặt thứ tự đúng để giảm compensation scope

Không phải lúc nào cũng cần saga phức tạp. Đôi khi, đặt thứ tự operations đúng cũng giảm đáng kể complexity của compensation.

Nguyên tắc: **làm external call trước nếu external system là source of truth; làm DB write trước nếu DB của bạn là source of truth.**

Với registration: Keycloak là authentication source of truth. Vì vậy:

```java
// Alternative approach: Keycloak-first
public PatientRegistrationResponse registerPatient(PatientRegistrationRequest request) {
    // Bước 1: Tạo Keycloak user trước
    String keycloakUserId = keycloakService.createUser(request.getEmail(), request.getPassword(), null);
    // Nếu fail ở đây: không có gì để compensate, clean state

    // Bước 2: Tạo DB record với Keycloak ID
    try {
        Patient patient = patientMapper.toEntity(request);
        patient.setKeycloakId(keycloakUserId);
        patient = patientRepository.save(patient);

        // Bước 3: Update Keycloak user với patient ID (link ngược lại)
        keycloakService.setUserAttribute(keycloakUserId, "patientId", patient.getId().toString());

        return patientMapper.toRegistrationResponse(patient);
    } catch (Exception e) {
        // Chỉ cần compensate Keycloak — DB chưa có gì
        keycloakService.deleteUser(keycloakUserId);
        throw new RegistrationException("Registration failed", e);
    }
}
```

Khi Keycloak-first, trường hợp cần compensation chỉ còn xảy ra khi DB fail (sau khi Keycloak đã thành công) — ít hơn so với DB-first approach.

---

## Điều cần nhớ về distributed state

Mỗi lần bạn có data tồn tại ở hai nơi — hai databases, database và external service, database và message queue — bạn đang quản lý distributed state. Và distributed state sẽ lệch nhau. Không phải "có thể lệch" — là "sẽ lệch", chỉ là vấn đề khi nào.

Câu hỏi quan trọng hơn "làm sao để không bị lệch" là: **"Khi lệch, mình phát hiện ra thế nào, và mình recover thế nào?"**

Reconciliation jobs, saga with persistent state, dead letter queues, và operational runbooks cho manual cleanup — tất cả đều là phần không thể thiếu của hệ thống xử lý distributed state nghiêm túc.

---

## Takeaway

Compensation pattern không phải là fallback plan. Nó phải là first-class design decision khi bạn bắt đầu thiết kế bất kỳ flow nào chạm đến nhiều hơn một system. Và compensation cũng có thể fail — đó là lý do cần saga với persistent state, không phải chỉ là try-catch.

---

*Bài tiếp theo: Tại sao user thấy data cũ dù đã update — cache consistency trong thực tế*
