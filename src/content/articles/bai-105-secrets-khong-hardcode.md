---
title: "Secrets không được hardcode — Spring profiles và env vars"
description: "Password trong application.yml commit lên Git là incident chờ xảy ra. Config theo môi trường, Spring profiles, và cách HMS tách secret khỏi codebase."
category: programming
pubDate: 2026-05-23
series: "Phần 2: Clean Code"
tags: ["clean-code", "spring-boot", "security", "configuration"]
---


Một intern push branch lên GitHub. Trong `application.yml` có dòng:

```yaml
spring:
  datasource:
    password: HMS_prod_2024!
```

Repo private. Chỉ team xem. Không sao đâu.

Sáu tháng sau repo được mirror sang CI log, một contractor được add vào org, hoặc ai đó fork nhầm sang public template. Password vẫn nằm trong git history — `git log -p` vẫn đọc được dù bạn đã xóa dòng đó ở commit sau. Rotate password toàn bộ stack, audit access log, báo security — vì một dòng config "tạm thời cho dev chạy được".

Người có kinh nghiệm không reject vì bạn dùng sai syntax YAML. Họ reject vì **secret và code không được sống chung**.

---

## Tại sao hardcode secret là incident, không phải style issue

Secret gồm: database password, Redis password, Keycloak client secret, JWT signing key, API key của payment gateway, AWS credentials.

Khi secret nằm trong git:

- **History bất di bất dịch** — xóa file không xóa history
- **Mọi clone đều mang theo** — laptop cũ, backup drive, log CI
- **Không rotate được an toàn** — đổi password DB phải sửa code và redeploy thay vì đổi env một chỗ
- **Không phân quyền theo môi trường** — dev và prod dùng chung một giá trị trong file là thảm họa chờ ngày dev script xóa nhầm data production

Code review không phải lớp bảo vệ cuối cùng cho secret. Git đã leak thì review không cứu được.

---

## Spring profiles — cùng codebase, khác môi trường

Spring Boot cho phép **profile** — bộ config kích hoạt theo môi trường:

```
application.yml          # defaults chung, KHÔNG có secret
application-dev.yml      # local: H2 hoặc local MySQL, port debug
application-staging.yml  # staging URLs
application-prod.yml     # prod URLs, vẫn KHÔNG password thật
```

```yaml
# application.yml — chỉ placeholder và cấu trúc
spring:
  application:
    name: hms-api
  datasource:
    url: ${DB_URL}
    username: ${DB_USERNAME}
    password: ${DB_PASSWORD}   # giá trị đến từ env, không hardcode

  data:
    redis:
      host: ${REDIS_HOST:localhost}
      port: ${REDIS_PORT:6379}
      password: ${REDIS_PASSWORD:}

keycloak:
  auth-server-url: ${KEYCLOAK_URL}
  credentials:
    secret: ${KEYCLOAK_CLIENT_SECRET}
```

`${DB_PASSWORD}` đọc từ environment variable hoặc từ secret manager khi deploy. File YAML trong repo chỉ mô tả **cần biến gì**, không chứa **giá trị gì**.

Chạy local:

```bash
export DB_PASSWORD=local_dev_only
./mvnw spring-boot:run -Dspring-boot.run.profiles=dev
```

Hoặc dùng `.env` **local** list trong `.gitignore`:

```
# .gitignore
.env
.env.*
!.env.example
```

```bash
# .env.example — COMMIT file này, chỉ là template
DB_URL=jdbc:mysql://localhost:3306/hms_dev
DB_USERNAME=hms_dev
DB_PASSWORD=change_me
KEYCLOAK_CLIENT_SECRET=change_me
```

Người mới copy `.env.example` → `.env`, điền giá trị thật, không bao giờ commit `.env`.

---

## Dev vs prod — không chỉ khác password

Profile không chỉ đổi secret. Nó đổi **hành vi**:

```yaml
# application-dev.yml
logging:
  level:
    com.hms: DEBUG
spring:
  jpa:
    show-sql: true

# application-prod.yml
logging:
  level:
    com.hms: INFO
spring:
  jpa:
    show-sql: false   # đừng log SQL có PHI ra log aggregation
```

Trên prod, payment gateway URL là endpoint thật; dev dùng sandbox. Keycloak realm khác. Redis có password; local có thể không. Một `application.yml` duy nhất với `if (prod)` trong code là anti-pattern — để Spring profile và `@Profile("dev")` bean xử lý.

```java
@Profile("dev")
@Bean
public PaymentGateway paymentGateway() {
    return new SandboxPaymentGateway();
}

@Profile("prod")
@Bean
public PaymentGateway paymentGateway(@Value("${payment.api-key}") String apiKey) {
    return new LivePaymentGateway(apiKey); // apiKey từ env
}
```

---

## `@ConfigurationProperties` — gom config, không rải `@Value`

```java
@ConfigurationProperties(prefix = "hms.storage")
public record StorageProperties(
    String bucket,
    String region,
    Duration presignedUrlTtl
) {}
```

```yaml
hms:
  storage:
    bucket: ${S3_BUCKET}
    region: ap-southeast-1
    presigned-url-ttl: 15m
```

Type-safe, test được bằng `@EnableConfigurationProperties` với giá trị fake trong test. Secret vẫn inject qua `${...}`, không nằm trong Java source.

---

## CI/CD và secret manager

Trên GitHub Actions, GitLab CI, hoặc K8s:

- Secret lưu trong **vault** / GitHub Encrypted Secrets / AWS Secrets Manager
- Pipeline inject vào env lúc deploy
- Application container nhận `DB_PASSWORD` từ K8s Secret, không bake vào Docker image

Image Docker build từ code **không** chứa prod password. Cùng image chạy staging và prod — chỉ khác env vars mount vào runtime.

---

## Những thứ vẫn hay bị quên

- **Default value trong YAML cho secret** — `${DB_PASSWORD:supersecret123}` vẫn là hardcode, chỉ giấu kỹ hơn
- **Test resources** — `src/test/resources/application-test.yml` đôi khi copy password thật "cho tiện". Dùng H2 hoặc Testcontainers với password random
- **Log** — đừng log full datasource URL có password; Spring Actuator `/env` trên prod phải được bảo vệ
- **Frontend** — API key "public" của map service vẫn nên restrict domain; **không** đặt Keycloak admin password trong React env `VITE_*` rồi build — mọi thứ trong frontend bundle là public

---

## Takeaway

Rule đơn giản: **nếu mất git repo mà attacker có quyền đọc toàn bộ history, họ không được có prod password.** Mọi secret là env var hoặc secret manager; YAML trong repo chỉ là skeleton. Copy `.env.example`, add `.env` vào `.gitignore`, và khi người có kinh nghiệm hỏi "password lấy từ đâu?" — câu trả lời đúng không bao giờ là "trong file application.yml dòng 42".

---

*Bài tiếp theo: @Transactional sâu hơn — proxy, self-invocation, và rollback rules.*
