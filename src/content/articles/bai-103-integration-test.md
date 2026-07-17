---
title: "Integration Test — tại sao unit test xanh hết mà vẫn deploy ra production bị lỗi"
description: "Unit test kiểm tra logic trong isolation. Integration test kiểm tra các layer phối hợp đúng không. @DataJpaTest, @WebMvcTest, @SpringBootTest — khi nào dùng cái nào và tại sao cần cả hai."
category: programming
pubDate: 2024-04-21
series: "Phần 2: Clean Code"
tags: ["clean-code", "testing", "integration-test", "spring-boot"]
---

---

Có một tình huống đủ phổ biến để trở thành meme trong cộng đồng dev: tất cả unit test pass, CI xanh, merge vào main, deploy — và production crash ngay lập tức.

Không phải vì unit test sai. Mà vì unit test không test đúng thứ đang fail.

---

## Unit test và cái nó không kiểm tra được

Unit test giỏi trong việc verify isolated logic: *"Hàm này với input X có trả về output Y không?"* Đó là giá trị thật sự của nó.

Nhưng hầu hết bugs production không nằm ở isolated logic. Chúng nằm ở **chỗ các mảnh ghép lại với nhau**:

- Code của bạn gọi query đúng, nhưng schema database đã thay đổi
- Service của bạn gọi đúng method, nhưng config Keycloak ở môi trường staging khác local
- Logic của bạn đúng, nhưng JSON serialization ra format mà client không parse được
- Transaction của bạn đúng, nhưng foreign key constraint ở database không cho phép

Unit test mock hết những dependency này — nên nó không bắt được những lỗi ở boundary.

Integration test là lớp test verify rằng các component hoạt động đúng **khi kết hợp với nhau**.

---

## Integration test trong Spring Boot trông như thế nào

Với `@SpringBootTest`, Spring khởi động toàn bộ application context — beans thật, không phải mock:

```java
@SpringBootTest
@AutoConfigureMockMvc
@ActiveProfiles("test")
class AppointmentIntegrationTest {

    @Autowired private MockMvc mockMvc;
    @Autowired private AppointmentRepository appointmentRepository;
    @Autowired private ObjectMapper objectMapper;

    @Test
    void shouldCreateAppointmentSuccessfully() throws Exception {
        // Arrange — dùng data thật trong database test
        AppointmentCreateRequest request = AppointmentCreateRequest.builder()
            .doctorId(UUID.fromString("doctor-001"))
            .patientId(UUID.fromString("patient-001"))
            .scheduleId(UUID.fromString("schedule-001"))
            .appointmentDate(LocalDate.now().plusDays(1))
            .timeSlot("10:00")
            .build();

        // Act — gọi thật qua HTTP stack
        mockMvc.perform(post("/api/v1/appointments")
                .contentType(MediaType.APPLICATION_JSON)
                .content(objectMapper.writeValueAsString(request))
                .header("Authorization", "Bearer " + generateTestToken()))
            .andExpect(status().isCreated())
            .andExpect(jsonPath("$.appointmentId").exists())
            .andExpect(jsonPath("$.status").value("PENDING"));

        // Assert — verify side effects trong database thật
        List<Appointment> saved = appointmentRepository.findByPatientId(UUID.fromString("patient-001"));
        assertThat(saved).hasSize(1);
        assertThat(saved.get(0).getStatus()).isEqualTo(AppointmentStatus.PENDING);
    }
}
```

Test này verify toàn bộ stack: HTTP layer → Controller → Service → Repository → Database. Nếu migration chưa chạy, nếu constraint sai, nếu serialization fail — test này bắt được.

---

## Database test với Testcontainers

Test với H2 in-memory là anti-pattern phổ biến — H2 có behavior khác MySQL, đặc biệt với SQL dialect, constraint, và function. Bạn đang test với database giả thay vì database thật.

Testcontainers khởi động một MySQL container thật trong quá trình test:

```java
@SpringBootTest
@Testcontainers
class AppointmentRepositoryIntegrationTest {

    @Container
    static MySQLContainer<?> mysql = new MySQLContainer<>("mysql:8.0")
        .withDatabaseName("hms_test")
        .withUsername("test")
        .withPassword("test");

    @DynamicPropertySource
    static void configureProperties(DynamicPropertyRegistry registry) {
        registry.add("spring.datasource.url", mysql::getJdbcUrl);
        registry.add("spring.datasource.username", mysql::getUsername);
        registry.add("spring.datasource.password", mysql::getPassword);
    }

    @Autowired private AppointmentRepository appointmentRepository;

    @Test
    void shouldFindAvailableSchedules() {
        // Test với MySQL thật — Flyway migrations cũng chạy tự động
        List<Appointment> result = appointmentRepository
            .findByDoctorIdAndDateAndActiveTrue(doctorId, LocalDate.now());
        
        assertThat(result).isNotEmpty();
    }
}
```

Container tự động start trước test và teardown sau — bạn không cần manage lifecycle thủ công. Và vì đây là MySQL thật, behavior giống production 1:1.

---

## Phân biệt khi nào dùng gì

Integration test chậm hơn unit test — một test suite với Testcontainers có thể mất vài phút. Bạn không dùng nó thay thế unit test, mà dùng song song:

**Unit test — test isolated logic:**
```java
// Nhanh, không cần database, không cần Spring context
@Test
void shouldRejectPastAppointmentDate() {
    AppointmentCreateRequest request = AppointmentCreateRequest.builder()
        .appointmentDate(LocalDate.now().minusDays(1))
        .build();
    
    assertThatThrownBy(() -> appointmentValidator.validate(request))
        .isInstanceOf(IllegalArgumentException.class);
}
```

**Integration test — test boundary và side effects:**
```java
// Chậm hơn, nhưng verify thứ unit test không verify được
@Test
void shouldRollbackTransactionWhenPaymentFails() throws Exception {
    // Setup: schedule với 1 slot còn lại
    // Action: tạo appointment nhưng payment fail
    // Assert: appointment KHÔNG được save vào database
    // Assert: slot count KHÔNG bị decrement
}
```

---

## Slice tests — middle ground

Không phải lúc nào cũng cần full `@SpringBootTest`. Spring Boot cung cấp "slice tests" — khởi động một phần context:

```java
// Chỉ khởi động JPA layer — không cần web layer
@DataJpaTest
class AppointmentRepositoryTest {
    @Autowired private AppointmentRepository appointmentRepository;
    // Test queries, custom methods, N+1 issues...
}

// Chỉ khởi động web layer — không cần database
@WebMvcTest(AppointmentController.class)
class AppointmentControllerTest {
    @MockBean private AppointmentService appointmentService;
    // Test request mapping, validation, response format...
}
```

Slice tests nhanh hơn full integration test nhưng vẫn verify nhiều hơn unit test thuần.

---

## Takeaway

Unit test và integration test không phải lựa chọn "cái này hoặc cái kia" — chúng test những thứ khác nhau. Nếu test suite của bạn chỉ có unit test, bạn đang có coverage trên giấy nhưng không verify thứ hay fail nhất trong production: chỗ các mảnh ghép lại với nhau. Thêm ít nhất một integration test cho mỗi critical flow — book appointment, process payment, send notification — là đủ để bắt được 80% bugs production trước khi chúng đến tay user.

---

*Bài tiếp theo: Tại sao Controller/Service/Repository thối theo thời gian — và kiến trúc nào giúp hệ thống sống sót dài hạn.*
