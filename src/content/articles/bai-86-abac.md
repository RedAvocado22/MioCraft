---
title: "Doctor chỉ thấy bệnh nhân của mình — ABAC implement đúng chỗ hay sai chỗ"
description: "Role-based access control không đủ cho bài toán: Doctor A chỉ xem được bệnh nhân của Doctor A. Attribute-based access control và cách implement đúng trong Spring Security."
category: system-design
pubDate: 2024-03-27
series: "Phần 10: Case Studies thực tế"
tags: ["case-study", "ABAC", "security", "authorization"]
---

Requirement nghe đơn giản: doctor chỉ được xem medical record của bệnh nhân mà họ đang điều trị. Admin thấy tất cả. Bệnh nhân chỉ thấy record của chính họ.

Sinh viên nghĩ đây là RBAC đơn giản: Doctor role, Patient role, Admin role. Gắn `@PreAuthorize("hasRole('DOCTOR')")` vào endpoint là xong.

Nhưng RBAC không đủ ở đây. Hai bác sĩ đều có Doctor role — nhưng không được thấy record của nhau's patients. Vấn đề không phải về *role*, mà về *ownership* và *relationship*. Đây là attribute-based access control (ABAC), và implement nó sai chỗ là một trong những lỗi kiến trúc phổ biến nhất trong healthcare systems.

---

## RBAC vs ABAC — ranh giới là gì

**RBAC (Role-Based Access Control):** Quyền được gắn với role. "Doctor có thể xem medical record." Tất cả doctor đều có cùng quyền truy cập.

**ABAC (Attribute-Based Access Control):** Quyền được quyết định dựa trên attributes của subject (người dùng), resource (tài nguyên), và context. "Doctor có thể xem medical record *nếu* doctor đó có active appointment với patient đó *trong* 30 ngày qua."

RBAC trả lời: *loại người dùng này có quyền làm gì?*
ABAC trả lời: *người dùng cụ thể này có quyền làm điều cụ thể này với tài nguyên cụ thể này không?*

---

## Implement sai — logic nằm sai chỗ

Cách sai phổ biến nhất: đặt access control logic vào controller hoặc để lọc ở tầng UI.

```java
// ❌ Vấn đề 1: Logic kiểm tra nằm trong controller
@GetMapping("/medical-records/{patientId}")
public ResponseEntity<List<MedicalRecordResponse>> getMedicalRecords(
    @PathVariable UUID patientId,
    @AuthenticationPrincipal JwtAuthenticationToken token
) {
    UUID requesterId = extractUserId(token);
    String role = extractRole(token);

    // Logic phức tạp nằm trong controller
    // Controller không phải chỗ đặt business rule
    if ("DOCTOR".equals(role)) {
        boolean hasRelationship = appointmentRepository
            .existsByDoctorIdAndPatientIdAndStatusNotAndDateAfter(
                requesterId, patientId,
                AppointmentStatus.CANCELLED,
                LocalDate.now().minusDays(30)
            );

        if (!hasRelationship) {
            return ResponseEntity.status(403).build();
        }
    }

    return ResponseEntity.ok(medicalRecordService.getRecords(patientId));
}
```

```java
// ❌ Vấn đề 2: Check đúng nhưng data vẫn leak qua endpoint khác
// Mày check ở GET /medical-records/{patientId}
// Nhưng quên check ở GET /patients/{patientId}/summary
// Hay GET /appointments/{appointmentId}/medical-history
// Security check phân tán = security holes phân tán
```

---

## Implement đúng — centralize ownership check

HMS xử lý bài toán này bằng cách đưa ownership logic vào một service riêng biệt, được gọi từ bất kỳ đâu cần kiểm tra access.

```java
// ✅ Ownership logic tập trung, testable, reusable
@Service
@RequiredArgsConstructor
public class PatientAccessPolicy {

    private final AppointmentRepository appointmentRepository;

    /**
     * Doctor có quyền xem patient data nếu có active hoặc recent relationship.
     * "Recent" = appointment trong 90 ngày — đủ để follow-up, không quá rộng.
     */
    public boolean doctorCanAccessPatient(UUID doctorId, UUID patientId) {
        return appointmentRepository.existsByDoctorIdAndPatientIdAndCriteria(
            doctorId,
            patientId,
            LocalDate.now().minusDays(90),
            List.of(AppointmentStatus.COMPLETED, AppointmentStatus.CONFIRMED, AppointmentStatus.IN_PROGRESS)
        );
    }

    /**
     * Patient chỉ được xem data của chính họ.
     */
    public boolean patientCanAccessOwnData(UUID requesterId, UUID patientId) {
        return requesterId.equals(patientId);
    }

    /**
     * Entry point: kiểm tra access dựa trên role của requester.
     * Admin bypass hết, còn lại theo policy.
     */
    public void assertCanAccessPatientData(UUID requesterId, String role, UUID patientId) {
        boolean hasAccess = switch (role) {
            case "ADMIN", "RECEPTIONIST" -> true;
            case "DOCTOR" -> doctorCanAccessPatient(requesterId, patientId);
            case "PATIENT" -> patientCanAccessOwnData(requesterId, patientId);
            default -> false;
        };

        if (!hasAccess) {
            // 403 thay vì 404: không nên hide existence của resource với internal roles
            // Nhưng với external access, 404 có thể phù hợp hơn để không leak data existence
            throw new AccessDeniedException("Insufficient access to patient data");
        }
    }
}
```

```java
// Service layer: enforce access policy trước khi trả data
@Service
@RequiredArgsConstructor
public class MedicalRecordService {

    private final MedicalRecordRepository medicalRecordRepository;
    private final PatientAccessPolicy accessPolicy;
    private final UserContext userContext; // lấy current user từ SecurityContext

    public List<MedicalRecordResponse> getPatientRecords(UUID patientId) {
        // Access check xảy ra ở service layer — không phải controller, không phải repository
        // Bất kể endpoint nào gọi vào đây cũng đều được protect
        accessPolicy.assertCanAccessPatientData(
            userContext.getCurrentUserId(),
            userContext.getCurrentUserRole(),
            patientId
        );

        return medicalRecordRepository
            .findByPatientIdOrderByCreatedAtDesc(patientId)
            .stream()
            .map(medicalRecordMapper::toResponse)
            .toList();
    }
}
```

```java
// Controller giờ clean — không có security logic
@GetMapping("/medical-records/{patientId}")
public ResponseEntity<List<MedicalRecordResponse>> getMedicalRecords(
    @PathVariable UUID patientId
) {
    return ResponseEntity.ok(medicalRecordService.getPatientRecords(patientId));
}
```

---

## Một vấn đề tinh tế hơn: indirect data exposure

Centralize access check giải quyết được direct access. Nhưng còn indirect exposure?

```java
// ❌ Vấn đề: endpoint này trả về appointment data
// Appointment chứa patient name, phone, diagnosis summary
// Doctor A có thể query appointment của Doctor B nếu không có additional check
@GetMapping("/appointments")
public ResponseEntity<Page<AppointmentResponse>> getAllAppointments(
    @RequestParam(required = false) UUID doctorId,
    Pageable pageable
) {
    // Nếu không filter theo current user, Doctor A có thể xem appointments của Doctor B
    return ResponseEntity.ok(appointmentService.getAppointments(doctorId, pageable));
}
```

```java
// ✅ Tốt hơn: filter based on current user context
@GetMapping("/appointments")
public ResponseEntity<Page<AppointmentResponse>> getMyAppointments(Pageable pageable) {
    // Không nhận doctorId từ request param
    // Lấy từ authentication context — không thể spoof
    UUID currentDoctorId = userContext.getCurrentUserId();
    return ResponseEntity.ok(appointmentService.getDoctorAppointments(currentDoctorId, pageable));
}
```

Nguyên tắc: **data filtering không được là optional parameter** khi nó là security boundary. Nếu doctor chỉ được thấy appointment của mình, doctorId filter không phải là `?doctorId=...` trên URL — nó phải đến từ authentication context.

---

## Keycloak và claim-based access

HMS dùng Keycloak, và JWT token chứa claims về user. Thay vì query DB để lấy role mỗi lần, claims đã có sẵn trong token:

```java
@Component
public class UserContext {

    public UUID getCurrentUserId() {
        JwtAuthenticationToken auth = (JwtAuthenticationToken) SecurityContextHolder
            .getContext()
            .getAuthentication();

        return UUID.fromString(auth.getToken().getSubject());
    }

    public String getCurrentUserRole() {
        JwtAuthenticationToken auth = (JwtAuthenticationToken) SecurityContextHolder
            .getContext()
            .getAuthentication();

        // Keycloak đặt roles trong realm_access.roles
        List<String> roles = auth.getToken()
            .getClaimAsStringList("realm_access.roles");

        // HMS dùng single role per user — lấy role chính
        return roles.stream()
            .filter(r -> List.of("DOCTOR", "PATIENT", "ADMIN", "RECEPTIONIST").contains(r))
            .findFirst()
            .orElse("UNKNOWN");
    }
}
```

Với claims trong JWT, access policy check không cần DB roundtrip cho role lookup — chỉ cần check relationship khi cần (doctor-patient relationship vẫn cần query DB).

---

## Takeaway

ABAC không phức tạp hơn RBAC về mặt concept — nó chỉ cần nhiều discipline hơn về nơi bạn đặt logic. Centralize policy check vào một service, enforce ở tầng service layer thay vì controller, và đừng để filter trở thành optional khi nó là security boundary. Một lỗ hổng access control trong healthcare system không phải là technical debt — nó là data breach.

---

*Bài tiếp theo: Keycloak revert fail — compensation pattern và cái giá của distributed state*
