---
title: "Tại sao game online biết vị trí nhân vật của người khác gần như realtime?"
description: "Trong PUBG hay Liên Quân, mày thấy nhân vật đối thủ chạy mượt dù họ ở đầu dây kia của internet. Không phải server gửi data 60 lần/giây — mà client đang tự diễn trên sân khấu của riêng nó, dựa trên dữ liệu 100ms cũ."
category: system-design
pubDate: 2026-07-15
series: "Behind the Tech: Real-time"
tags: ["game-dev", "networking", "udp", "client-side-prediction", "real-time", "interpolation"]
---

Mày đang chơi PUBG Mobile, thấy một thằng địch đang chạy từ trái sang phải phía xa. Animation mượt, không lag, dù thằng đó đang ở Hà Nội còn mày ở TP.HCM, cách nhau mấy trăm kilometre. Mày ngắm, bắn, miss.

Bình thường mày không nghĩ gì. Nhưng nếu nghĩ kỹ: làm sao game biết vị trí thằng địch gần như realtime? Nếu game gửi packet mỗi frame thì với 100 người chơi trong một trận, đó là 60 × 100 = 6,000 packets/giây per client. Không đường truyền nào chịu được cái đó. Vậy trick là gì?

## Cách naive — tại sao nó không work

Giả sử mày nghĩ đơn giản: server cập nhật vị trí tất cả mọi người 60 lần/giây (60fps), gửi xuống từng client.

```
100 players × vị trí 3D (12 bytes) × 60fps = 72,000 bytes/giây = ~72 KB/s
```

Per player, 72KB/s không nghe có vẻ nhiều. Nhưng đây là phép tính lạc quan nhất — thực tế mỗi entity state còn chứa rotation, velocity, animation state, health, action flags... Nhân lên vài lần. Rồi nhân tiếp cho 100 players đang nhận data về 99 người còn lại.

Và đó là chưa kể latency. TCP đảm bảo mọi packet đến đúng thứ tự và đầy đủ — nếu một packet bị mất, TCP retry, tất cả packet sau phải chờ. Trong game realtime, packet từ 100ms trước là vô nghĩa. Chờ nó để đảm bảo ordering chỉ làm mọi thứ tệ hơn.

60fps networking với TCP là bất khả thi. Game AAA không ai làm vậy.

## Cái trick thật sự đằng sau

Game online giải quyết bài toán này bằng bốn kỹ thuật kết hợp:

**1. UDP thay vì TCP**

UDP không có retransmission, không có ordering guarantee. Packet bị mất → bỏ qua luôn, tiếp tục với packet tiếp theo. Đây là điều mày muốn trong game: thà bỏ qua vị trí cũ 50ms còn hơn chờ nó đến trễ và làm gameplay giật.

```
TCP: [pkt1] → [pkt2 lost!] → [wait...wait...] → [pkt2 retry] → [pkt3]
                                                  ↑ unacceptable lag

UDP: [pkt1] → [pkt2 lost!] → [pkt3] → [pkt4]
                  ↑ skip, không ai quan tâm
```

**2. Client-side prediction cho nhân vật của chính mày**

Khi mày nhấn phím W để chạy, nhân vật của mày di chuyển ngay lập tức trên màn hình — không chờ server confirm. Client tự tính toán vật lý và movement, hiển thị ngay.

Nếu phải chờ server: mày nhấn W → gửi lên server → server xử lý (~50-150ms latency) → server gửi lại vị trí mới → client hiển thị. Lag 100-300ms mỗi lần nhấn phím. Unplayable.

**3. Server reconciliation**

Server vẫn là authoritative — quyết định sau cùng. Mỗi ~100ms, server gửi "ground truth" về trạng thái thật của tất cả entities. Nếu vị trí mà client predict khác với server confirm, client phải correct.

"Rubber-banding" xảy ra ở đây: khi correction quá đột ngột, nhân vật bị "kéo ngược" về vị trí cũ. Thường là dấu hiệu của high latency hoặc server-client state diverge quá lớn.

**4. Entity interpolation cho nhân vật người khác**

Đây là kỹ thuật quan trọng nhất để nhân vật đối thủ trông mượt.

Server tick mỗi 100ms (10Hz). Client render 60fps. Khoảng cách giữa hai server tick là 100ms — trong đó client cần render 6 frames. Mày biết vị trí của đối thủ tại t=0 và t=100ms, cần render 6 frames ở giữa.

Giải pháp: **interpolation** giữa hai vị trí đã biết. Client buffer lại hai vị trí gần nhất từ server, rồi tính toán vị trí trung gian khi render.

```
Server ticks:     A-----------B-----------C
                t=0         t=100ms     t=200ms

Client render:    A--a--b--c--B--d--e--f--C
                  ↑ interpolated frames
```

Hệ quả: mày luôn đang xem nhân vật đối thủ ở trạng thái **100ms trong quá khứ**. Không phải realtime thật sự — mà là realtime đủ tốt để gameplay feel responsive.

## Đi sâu hơn — chi tiết kỹ thuật

**Server tick rate** là tần suất server xử lý và gửi state update. Đây là thông số mày thường thấy trong game competitive:

```
Counter-Strike 2:  128 tick (competitive) / 64 tick (casual)
Valorant:          128 tick
PUBG:              ~30 tick
Liên Quân Mobile:  ~20-30 tick
```

Tick rate cao hơn = state update thường xuyên hơn = gameplay chính xác hơn, nhưng bandwidth và server CPU tăng theo tuyến tính. 128 tick nghĩa là server xử lý mỗi ~7.8ms, so với 50ms của 20 tick.

**Timeline đầy đủ của một frame:**

```
t=0ms     Server tick: server nhận input từ tất cả clients,
           tính toán physics, gửi state xuống

t=0-50ms  Network travel time (latency của mày)

t=50ms    Client nhận packet từ server tick t=0
           → lưu vào buffer

t=50-110ms Client render 60fps:
           - Nhân vật của mày: render từ client-side prediction
           - Nhân vật địch: interpolate giữa t=-100ms và t=0
             (mày đang xem "quá khứ" của địch)

t=100ms   Server tick tiếp theo
```

**Extrapolation là cạm bẫy:** Thay vì interpolate giữa hai điểm đã biết, một số game thử *extrapolate* — dự đoán vị trí tương lai dựa trên velocity hiện tại. Nghe hay nhưng khi địch đột ngột đổi hướng, extrapolation tạo ra "ghost position" sai hoàn toàn, rồi phải snap về vị trí thật. Trông tệ hơn interpolation nhiều.

**Lag compensation** là kỹ thuật để giải quyết một vấn đề thú vị: khi mày bắn trúng địch trên màn hình mày, địch đó thực ra đang ở vị trí khác trên server (do mày đang nhìn quá khứ 100ms). Server phải "rewind" state về 100ms trước để check xem viên đạn của mày có trúng vào vị trí địch lúc mày bắn không.

```
Server state hiện tại:    Địch ở vị trí B
Mày bắn khi địch ở:       Vị trí A (100ms trước)
Server rewind về t-100ms: Check hit tại vị trí A ← TRÚNG
```

Đây là lý do đôi khi mày thấy "killcam" cho thấy địch đã núp đằng sau tường nhưng mày vẫn die — trên server state (đã rewind) mày thật sự lộ.

**Cheating và server authority:** Toàn bộ movement validation xảy ra trên server. Nếu client gửi packet nói "tao đã teleport từ A đến B trong 10ms", server có thể phát hiện velocity không hợp lệ và reject. Đây là lý do anticheat phức tạp hơn chỉ scan memory — cần server-side validation từng packet movement.

## Mày thấy nó ở đâu trong thực tế

**PUBG Mobile, Call of Duty Mobile:** Dùng UDP + client-side prediction + interpolation theo mô tả trên. Tick rate thấp (~20-30Hz) vì cần scale cho nhiều người chơi với chi phí server hợp lý.

**Valve Source Engine (CS2, Left 4 Dead):** Tick rate 64/128Hz. Valve open-source tài liệu network architecture — nếu mày muốn đọc deep dive thật sự thì search "Valve Multiplayer Networking" trên developer.valvesoftware.com.

**League of Legends, Liên Quân:** Game MOBA đơn giản hơn về mặt networking vì di chuyển chậm hơn FPS. Dùng lockstep networking model thay vì client-side prediction — tất cả clients đồng bộ từng game tick, đảm bảo deterministic gameplay. Trade-off: cần mọi người có input trong mỗi tick, nên một người lag là tất cả cảm nhận được.

**Multiplayer racing games:** Client-side prediction aggressive hơn — xe của mày luôn responsive 100%. Entity interpolation cho xe địch. Khi reconciliation xảy ra, thường smooth bằng cách "fast-forward" xe địch về vị trí đúng thay vì teleport.

## Một dòng để nhớ

Smooth gameplay không đến từ server nhanh — mà đến từ client đủ thông minh để tự chạy show, dùng server như một anchor để không drift quá xa thực tế.

---
*Bài tiếp theo: Tại sao Google Docs nhiều người edit cùng lúc mà không đè lên nhau?*
