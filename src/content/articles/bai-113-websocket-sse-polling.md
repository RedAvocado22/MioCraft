---
title: "WebSocket, SSE, và Polling — khi nào dùng cái nào"
description: "HTTP không tự push. Short polling đốt server, SSE cho one-way realtime, WebSocket khi cần hai chiều — chọn sai là mở connection vô ích hoặc over-engineer notification đơn giản."
category: system-design
pubDate: 2026-05-31
series: "Phần 7: Backend & Hệ thống"
tags: ["backend", "websocket", "sse", "polling", "realtime"]
---


Reception desk cần màn hình tự cập nhật khi bệnh nhân check-in — không reload trang. Junior gắn `setInterval` gọi `GET /api/queue` mỗi giây. Mười quầy × 60 request/phút × 8 giờ ca = hàng chục nghìn request chỉ để hỏi *"có gì mới không?"* — câu trả lời thường là không.

Backend log đầy `200 OK` giống nhau. DB connection pool nhích dần. Senior hỏi: *"Sao không dùng SSE?"* Mày hỏi lại: *"WebSocket có phải realtime không?"*

Cả ba đều giải bài toán **server muốn đẩy thông tin xuống client** — nhưng chi phí, hướng dữ liệu, và hạ tầng khác nhau hẳn. Chọn theo hype là cách nhanh nhất để vừa tốn connection vừa khó debug.

---

## HTTP mặc định: client hỏi, server trả lời

REST API HMS — đặt lịch, xem hồ sơ — mô hình request-response là đủ. Client chủ động. Server không gọi ngược lại browser được.

Khi product cần *"bác sĩ thấy notification ngay khi có lịch mới"* hoặc *"màn hình phòng khám nhảy số thứ tự realtime"* — mày phải chọn một trong:

1. **Polling** — client hỏi liên tục
2. **SSE (Server-Sent Events)** — server giữ một kết nối HTTP, đẩy event một chiều
3. **WebSocket** — kết nối hai chiều, full-duplex

Không có option thứ tư "REST thuần tự realtime" mà không đổi kiến trúc.

---

## Polling — đơn giản nhất, đắt nhất khi lặp nhanh

**Short polling:** client gọi API theo chu kỳ cố định.

```javascript
// ❌ Mỗi giây một request dù queue không đổi
setInterval(async () => {
  const res = await fetch('/api/reception/queue', { headers: authHeaders });
  setQueue(await res.json());
}, 1000);
```

Vấn đề:

- Phần lớn request trả về data **y hệt** lần trước — lãng phí CPU, bandwidth, connection pool
- Interval ngắn → tải tăng tuyến tính theo số tab/màn hình mở
- Interval dài → UX lag (user thấy update chậm 30 giây)

**Long polling:** client gọi, server **giữ** request đến khi có event hoặc timeout, rồi client gọi lại ngay.

```java
@GetMapping("/api/notifications/wait")
public DeferredResult<List<NotificationDto>> waitForNotifications(
    @AuthenticationPrincipal Jwt jwt) {

  var result = new DeferredResult<List<NotificationDto>>(Duration.ofSeconds(30).toMillis());
  notificationWaitRegistry.register(jwt.getSubject(), result);
  result.onTimeout(() -> result.setResult(List.of())); // client reconnect
  return result;
}
```

Cải thiện so với short polling (ít request rỗng hơn) nhưng vẫn **một request một lần "chờ"**, thread/async resource phức tạp, không chuẩn hóa bằng SSE. Hôm nay ít team chọn long polling cho greenfield — SSE thay thế tốt hơn cho one-way push.

Polling vẫn **hợp lý** khi:

- Update không cần realtime (dashboard admin refresh 30s–5 phút)
- Client không giữ connection lâu (mobile background hạn chế)
- Infra cấm long-lived connection qua corporate proxy

---

## SSE — server đẩy, client nghe (one-way)

SSE dùng HTTP thường: response `Content-Type: text/event-stream`, connection mở, server gửi từng event dạng text:

```
event: appointment-updated
data: {"appointmentId":"...","status":"CHECKED_IN"}

```

Browser `EventSource` tự reconnect khi đứt — built-in cho use case one-way.

Spring Boot:

```java
@RestController
@RequestMapping("/api/reception")
public class QueueStreamController {

  private final QueueEventBroadcaster broadcaster;

  @GetMapping(value = "/queue/stream", produces = MediaType.TEXT_EVENT_STREAM_VALUE)
  public SseEmitter streamQueue(@AuthenticationPrincipal Jwt jwt) {
    SseEmitter emitter = new SseEmitter(Duration.ofMinutes(30).toMillis());
    broadcaster.subscribe(receptionDeskId(jwt), emitter);
    emitter.onCompletion(() -> broadcaster.unsubscribe(emitter));
    emitter.onTimeout(emitter::complete);
    return emitter;
  }
}
```

Khi appointment check-in, service publish event:

```java
@Service
public class AppointmentService {
  private final QueueEventBroadcaster broadcaster;

  @Transactional
  public void checkIn(UUID appointmentId) {
    var appointment = /* ... */;
    appointment.checkIn();
    appointmentRepository.save(appointment);
    broadcaster.publish(appointment.getReceptionDeskId(),
        new QueueUpdateEvent(appointmentId, QueueStatus.CHECKED_IN));
    // Lưu ý: publish trong @Transactional — nếu cần đảm bảo chỉ gửi sau commit,
    // dùng @TransactionalEventListener(AFTER_COMMIT) thay vì gọi trực tiếp (xem bài 85)
  }
}
```

**Ưu SSE:**

- Một chiều server → client — đúng với notification, queue display, trạng thái lịch hẹn
- Đi qua HTTP/HTTPS, firewall/proxy thân thiện hơn WebSocket đôi khi
- `EventSource` đơn giản, auto-reconnect
- Scale ngang: nhiều instance Spring → **Redis Pub/Sub** (hoặc message broker) broadcast event tới mọi node, mỗi node push tới SSE client của mình

```text
AppointmentService → Redis channel "queue-updates"
                         ↓
Instance A, B, C subscribe → SseEmitter tới browser đang nối instance đó
```

**Nhược SSE:**

- Chỉ text (JSON string trong `data:` — đủ cho HMS)
- Một số proxy buffer response — cần config `X-Accel-Buffering: no` nếu nginx
- Giới hạn connection per browser (~6/domain HTTP/1.1) — ít khi chạm với vài stream

HMS: **màn hình reception, thông báo cho doctor, trạng thái appointment đang chờ** — SSE thường là default đúng.

---

## WebSocket — hai chiều, khi client cũng gửi liên tục

WebSocket upgrade từ HTTP: `ws://` hoặc `wss://`, frame hai chiều, overhead thấp hơn khi chat ping-pong liên tục.

Spring với STOMP + SockJS (fallback khi WS bị chặn):

```java
@Configuration
@EnableWebSocketMessageBroker
public class WebSocketConfig implements WebSocketMessageBrokerConfigurer {

  @Override
  public void configureMessageBroker(MessageBrokerRegistry registry) {
    registry.enableSimpleBroker("/topic"); // broadcast
    registry.setApplicationDestinationPrefixes("/app");
  }

  @Override
  public void registerStompEndpoints(StompEndpointRegistry registry) {
    registry.addEndpoint("/ws")
        .setAllowedOrigins(allowedOrigins)
        .withSockJS();
  }
}
```

Client subscribe `/topic/doctor/{doctorId}/appointments`, server gửi khi có lịch mới.

**Dùng WebSocket khi:**

- Chat nội bộ bác sĩ–điều dưỡng, typing indicator
- Collaborative edit (hiếm trong HMS phase 1)
- Game-like hoặc binary stream liên tục hai chiều
- Client gửi message liên tục lên server (sensor, game input) — không chỉ nhận push

**Không cần WebSocket khi:**

- Chỉ cần "server báo có notification mới" — SSE đủ, stack đơn giản hơn
- Mày muốn tránh thêm STOMP session, heartbeat, security config riêng cho `/ws`

WebSocket + JWT: authenticate lúc **handshake** (query param hoặc header — header khó với browser WS API; pattern phổ biến: short-lived ticket từ REST rồi connect WS). Đừng quên authorize topic — doctor A không subscribe được stream của doctor B.

---

## So sánh nhanh

| | Short polling | SSE | WebSocket |
|--|---------------|-----|-----------|
| Hướng | Client → server mỗi lần | Server → client | Hai chiều |
| Connection | Ngắn, lặp | Một HTTP dài | Một TCP dài |
| Độ phức tạp backend | Thấp | Trung bình | Cao hơn |
| Realtime | Phụ thuộc interval | Tốt | Tốt |
| Scale multi-instance | Dễ (stateless GET) | Cần Redis pub/sub | Cần broker / sticky |
| HMS fit | Dashboard chậm | Queue, notification | Chat, tương tác hai chiều |

---

## Scale thực tế — đừng quên connection là tài nguyên

Mỗi SSE/WebSocket = connection + memory + thread/async slot trên server (tùy impl). 500 màn hình reception mở cùng lúc = 500 connection — vẫn ổn nếu thiết kế đúng; 50.000 thì cần architecture review.

Multi-instance Spring Boot:

- **Không** assume event chỉ publish trong JVM local — dùng Redis Pub/Sub hoặc Kafka
- Load balancer: sticky session **hoặc** shared message bus (sticky dễ lệch tải)
- Timeout và heartbeat: proxy nginx `proxy_read_timeout` phải lớn hơn idle SSE

Fallback khi SSE fail: polling chậm (30s) hoặc nút "Làm mới" — degradation có chủ đích.

---

## Liên quan notification đã có trong HMS

Nhiều flow HMS đã dùng **email/SMS/push sau `@TransactionalEventListener(AFTER_COMMIT)`** — đó là async one-shot, không phải realtime trên UI.

Phân tầng:

- **In-app bell icon realtime** → SSE hoặc WebSocket + persist notification trong DB
- **Email "lịch hẹn ngày mai"** → queue (Rabbit/Kafka) hoặc scheduler — không cần WS
- **Patient mobile push** → FCM/APNs — third-party, không qua connection browser

Đừng mở WebSocket chỉ để thay thế email.

---

## Takeaway

Hỏi một câu trước khi chọn: *"Client có cần gửi stream liên tục lên server, hay chỉ cần nghe server báo?"* Chỉ nghe → **SSE**. Hai chiều thật sự → **WebSocket**. Không cần sub-giây, chấp nhận delay → **polling chậm** vẫn là code đơn giản nhất. Và nếu mày đang `setInterval(..., 1000)` lên endpoint queue — dừng lại, tính request/phút × số màn hình; con số đó chính là lý do senior reject.

---

*Bài tiếp theo: (tiếp Phần 7 — Backend Internals)*
