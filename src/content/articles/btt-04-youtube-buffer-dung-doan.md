---
title: "Tại sao YouTube không buffer từ đầu mà buffer đúng đoạn mày đang xem?"
description: "YouTube không download cả video — nó chỉ tải đúng mấy giây xung quanh chỗ mày đang xem. Đây là cách DASH, manifest file, và adaptive bitrate làm điều đó."
category: system-design
pubDate: 2026-07-05
series: "Behind the Tech: App & UX"
tags: ["streaming", "dash", "hls", "adaptive-bitrate", "video", "performance"]
---

Mày mở một video YouTube 2 tiếng. Ba giây sau, nó chạy được. Mày nhìn xuống thanh tiến trình — chỉ có một đoạn nhỏ màu xám phía trước. Rồi mày kéo thẳng đến phút 1:23:45 — và nó vẫn chạy được gần như ngay lập tức.

Tại sao không phải đợi cả 2 tiếng load xong mới xem được? Và tại sao kéo đến bất kỳ chỗ nào trong video cũng chỉ load vài giây chứ không phải từ đầu? Có chuyện gì đang xảy ra phía sau cái thanh tiến trình đó?

> **TL;DR:** Video được chặt thành hàng trăm mảnh nhỏ 2-4 giây. Player chỉ tải đúng mảnh đang cần — không cần tải toàn bộ. Kéo đến phút bất kỳ = tải mảnh tương ứng trực tiếp, không phải tua qua hết.

## Cách naive — tại sao nó không work

Cách đơn giản nhất: download cả file video trước, rồi mới cho xem. Kiểu như download phim về máy. Không cần xử lý gì phức tạp, browser load file, player đọc file, xong.

Vấn đề rõ ràng: video 2 tiếng ở 1080p nặng khoảng 8–10 GB. Không ai muốn chờ 20 phút để xem 30 giây đầu tiên.

Vậy thì cách naive thứ hai: download từ đầu video, stream dần dần. Mày xem đến đâu, data đến đó. Cũng là cách HTTP streaming cơ bản hoạt động. Nhưng vẫn có vấn đề lớn: nếu mày skip đến phút 90, player phải download tất cả data từ đầu đến phút 90 rồi mới có thể xem tiếp — hoặc đơn giản là không support seeking được. Chưa kể nếu mày đang xem bằng mạng 3G thì chất lượng video vẫn là 1080p, buffer liên tục, lag liên tục.

Cả hai cách này đều bỏ qua một thực tế: mày chỉ cần *đoạn đang xem*, không cần cả video.

## Cái trick thật sự đằng sau

YouTube dùng **DASH (Dynamic Adaptive Streaming over HTTP)** — hoặc HLS trên Safari/iOS.

> **Hãy tưởng tượng:** Video 2 tiếng không phải là một quyển sách dày mà là 1.800 tờ giấy rời — mỗi tờ là 4 giây. Mày chỉ cần tờ số 1 để bắt đầu xem. Muốn nhảy đến phút 90? Lấy tờ số 1350. Không cần đọc qua 1349 tờ trước.

Ý tưởng cốt lõi là chặt nhỏ video thành từng mảnh 2–4 giây, lưu ở nhiều chất lượng khác nhau.

Khi mày mở một video, thứ đầu tiên player tải về không phải video — mà là một file gọi là **manifest** (`.mpd` cho DASH, `.m3u8` cho HLS). File này là bản đồ của toàn bộ video:

```
Segment 1  (0s–4s):   /seg_001_360p.mp4, /seg_001_720p.mp4, /seg_001_1080p.mp4
Segment 2  (4s–8s):   /seg_002_360p.mp4, /seg_002_720p.mp4, /seg_002_1080p.mp4
Segment 3  (8s–12s):  /seg_003_360p.mp4, /seg_003_720p.mp4, /seg_003_1080p.mp4
...
Segment 900 (3596s–3600s): /seg_900_360p.mp4, ...
```

Manifest file này nhỏ — vài chục KB. Download nhanh. Và từ đó, player biết URL của từng segment ở từng chất lượng.

Luồng hoạt động trông như thế này:

```
Browser                          CDN/Server
  |                                  |
  |--- GET manifest.mpd -----------> |
  |<-- danh sách 900 segments ------  |
  |                                  |
  |--- GET seg_001_720p.mp4 -------> |   (chơi ngay)
  |--- GET seg_002_720p.mp4 -------> |   (buffer ahead)
  |--- GET seg_003_720p.mp4 -------> |   (buffer ahead)
  |                                  |
  [mày đang xem segment 1]           |
  |--- GET seg_004_720p.mp4 -------> |   (tiếp tục buffer)
  ...
```

Player chỉ request các segment gần với vị trí playhead hiện tại — thường là buffer trước khoảng 30 giây. Không hơn. Không cần biết segment 450 ở đâu cho đến khi mày kéo đến đó.

**Khi mày seek đến phút 1:23:45:** Player tính ra đó là segment số bao nhiêu (ví dụ segment 624), tìm URL của segment đó trong manifest, request thẳng segment đó từ CDN. Discard hết buffer cũ. Download lại từ segment 624 trở đi. Đó là lý do seek nhanh — không có gì cần "nhảy qua" cả, chỉ là một HTTP GET request khác.

Về mặt HTTP, mỗi segment download là một **range request** thông thường — `GET /seg_624_720p.mp4` — không có magic gì đặc biệt. CDN cache từng segment độc lập, scale cực tốt.

## Nếu bạn muốn hiểu sâu hơn _(đọc thêm, không bắt buộc)_

Phần thú vị nhất của DASH là **ABR — Adaptive Bitrate**. Đây là thuật toán quyết định nên download segment nào ở chất lượng nào.

Player liên tục theo dõi hai số:
1. **Bandwidth estimate**: tốc độ download trung bình của N segment gần nhất
2. **Buffer level**: hiện tại đang có bao nhiêu giây video đã được buffer

ABR algorithm (simplified) hoạt động kiểu:

```
if buffer < 10s:
    step down quality (tránh buffer cạn kiệt)
elif buffer > 30s AND bandwidth_estimate >= next_quality_bitrate * 1.5:
    step up quality (đủ điều kiện lên cao hơn)
else:
    giữ nguyên
```

Hệ số 1.5x là safety margin — không muốn lên 1080p rồi ngay lập tức phải xuống vì bandwidth estimate sai. YouTube có thêm một lớp: họ track lịch sử chất lượng để tránh "oscillation" — nhảy lên xuống liên tục gây khó chịu.

Một chi tiết nữa: manifest file không chỉ có URL, nó còn chứa metadata như `bandwidth`, `codecs`, `width`, `height` cho từng quality level. Player dùng những số này để lấy quyết định ban đầu trước khi có đủ data đo bandwidth thực tế.

Về codec: YouTube encode mỗi segment thành nhiều codec song song — H.264, VP9, AV1. Browser support cái gì thì player pick cái đó. AV1 nhỏ hơn ~30% so với H.264 ở cùng chất lượng, nhưng encode nặng hơn nhiều.

## Mày thấy nó ở đâu trong thực tế

**Netflix** dùng DASH với một twist: họ có hệ thống encode riêng gọi là *per-title encoding*. Thay vì encode mọi video ở cùng bitrate ladder, họ analyze từng bộ phim và tìm bitrate tối ưu cho nó. Phim hoạt hình ít detail → encode ở bitrate thấp hơn vẫn đẹp. Phim action nhiều motion → cần bitrate cao hơn. Kết quả: cùng chất lượng nhưng tốn ít bandwidth hơn tới 20%.

**Twitch** và livestream dùng HLS vì nó phù hợp hơn với live content — manifest file được update liên tục khi có segment mới. DASH cũng có live profile nhưng HLS phổ biến hơn trong live streaming. Độ trễ của HLS thường 6–30 giây; Twitch có "Low Latency HLS" giảm xuống còn 2–3 giây bằng cách dùng segment 0.5–1 giây thay vì 4–6 giây.

**Zoom/Meet** không dùng DASH hay HLS vì đó là video conference cần real-time (< 150ms latency) — họ dùng WebRTC, một protocol hoàn toàn khác. DASH và HLS đánh đổi latency để lấy quality và reliability, nên chỉ phù hợp với on-demand hoặc livestream có thể chịu vài giây delay.

## Một dòng để nhớ

YouTube không stream video — nó stream một danh sách URL và tự quyết định URL nào cần download tiếp theo.

---
*Bài tiếp theo: Tại sao kéo refresh trên app mobile có animation mượt — và nó sync với server lúc nào?*
