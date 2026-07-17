---
title: "Message đã vào queue nhưng handler chưa chạy — converter cũng là một phần của hệ thống"
description: "Exchange và binding đều đúng chưa có nghĩa business logic đã chạy. Message converter sai có thể làm listener fail trước dòng code đầu tiên."
category: system-design
pubDate: 2026-07-17
addedDate: 2026-07-17
series: "Phần 7: Backend & Hệ thống"
tags: ["rabbitmq", "message-queue", "spring-amqp", "debugging", "case-study"]
---

RabbitMQ console báo message đã vào đúng queue. Exchange đúng. Binding đúng. Nhưng contract vẫn nằm ở `SIGNED`, escrow không chuyển trạng thái, và log trong handler hoàn toàn im lặng.

Phản xạ đầu tiên thường là kiểm tra routing key. Nhưng routing chỉ là **một** bước trong pipeline. Message còn phải được convert thành đúng kiểu dữ liệu trước khi Spring gọi method listener.

## Có ba bước, không phải một

Một message đi qua ít nhất ba lớp:

```text
Producer
  → exchange / binding / queue
  → message converter
  → method invocation của consumer
```

Queue nhận được message chỉ chứng minh bước đầu tiên thành công. Nó không chứng minh consumer đã nhận được một `Map`, một DTO, hay bất kỳ object nào mà method đang khai báo.

## Routing đúng nhưng method vẫn fail

Một cấu hình đơn giản có thể chỉ khai báo exchange, queue và binding:

```java
@Bean
Declarables topology() {
    return new Declarables(exchange, queue, binding);
}
```

Nếu không cấu hình converter, Spring AMQP có thể dùng `SimpleMessageConverter` mặc định. Trong khi đó outbox thường lưu payload dưới dạng JSON string:

```java
var payload = objectMapper.writeValueAsString(event);
rabbitTemplate.convertAndSend(exchangeName, routingKey, payload);
```

Producer gửi một `String` có content type giống text. Consumer lại khai báo:

```java
@RabbitListener(queues = "contract-svc.escrow.locked")
public void onEscrowLocked(Map<String, Object> event) {
    // business logic
}
```

Khi đó flow thực tế có thể là:

```text
JSON String
  → byte[] với content-type text/plain
  → listener nhận String
  → Spring cố gán String vào Map
  → exception trước khi vào method body
```

Đó là lý do log đầu tiên bên trong `onEscrowLocked()` không xuất hiện. Handler chưa chạy đến dòng đó để mà log.

## Cấu hình converter ở cả hai phía

Producer và consumer là hai application context khác nhau. Converter khai báo ở service gửi không tự động áp dụng cho service nhận.

```java
@Bean
Jackson2JsonMessageConverter jsonMessageConverter(ObjectMapper objectMapper) {
    return new Jackson2JsonMessageConverter(objectMapper);
}

@Bean
RabbitTemplate rabbitTemplate(
        ConnectionFactory connectionFactory,
        Jackson2JsonMessageConverter converter
) {
    var template = new RabbitTemplate(connectionFactory);
    template.setMessageConverter(converter);
    return template;
}

@Bean
SimpleRabbitListenerContainerFactory rabbitListenerContainerFactory(
        ConnectionFactory connectionFactory,
        Jackson2JsonMessageConverter converter
) {
    var factory = new SimpleRabbitListenerContainerFactory();
    factory.setConnectionFactory(connectionFactory);
    factory.setMessageConverter(converter);
    return factory;
}
```

Converter giải quyết việc serialize/deserialize. Nó không giải quyết việc payload bị serialize hai lần. Nếu outbox đã lưu JSON string, poller cần parse nó thành object hoặc `Map` trước khi đưa cho `RabbitTemplate`; nếu đưa nguyên string vào JSON converter, payload có thể bị bọc thêm một lớp quote.

## Đừng debug mỗi routing key

Khi event không làm thay đổi state, kiểm tra theo thứ tự này sẽ nhanh hơn:

1. Producer có ghi outbox row không?
2. Poller có đọc row và publish đúng exchange/routing key không?
3. Queue có nhận message không?
4. Content type của message là JSON hay text?
5. Converter có tạo đúng kiểu tham số listener không?
6. Method body có chạy nhưng business logic bị skip bởi idempotency guard không?

Mỗi lớp có một kiểu lỗi khác nhau. Nhìn thấy message trong queue rồi kết luận “RabbitMQ hoạt động” là chưa đủ.

## Integration test phải đi qua broker thật

Unit test gọi thẳng `onEscrowLocked(map)` sẽ không bắt được lỗi converter. Test đó chỉ chứng minh business method xử lý được một `Map` đã chuẩn bị sẵn.

Một integration test có giá trị hơn phải publish JSON qua `RabbitTemplate`, để message đi qua converter, queue và listener container. Sau đó mới assert state của aggregate thay đổi.

Có thể chia test thành ba tầng:

- **Serialization test:** event round-trip thành JSON rồi deserialize lại được.
- **Broker test:** publish vào exchange, message tới đúng queue và listener nhận đúng type.
- **Business test:** event hợp lệ làm state transition; event duplicate được skip; payload sai bị reject.

## Takeaway

Một message “đã vào queue” mới chỉ đi được nửa đường. Trong hệ thống event-driven, routing, conversion và invocation là ba failure point khác nhau.

Khi handler im lặng, đừng chỉ nhìn exchange và binding. Hãy kiểm tra message converter và content type — vì có thể business logic chưa từng được gọi.

---

*Bài liên quan: Message Queue — khi nào cần, khi nào không.*
