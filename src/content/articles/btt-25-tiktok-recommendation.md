---
title: "Tại sao TikTok biết mày thích xem gì chỉ sau vài video?"
description: "Instagram Reels mất nhiều tháng để hiểu mày. TikTok chỉ cần 10 phút. Không phải magic — đó là implicit signals, cold start strategy, và two-stage recommendation pipeline."
category: system-design
pubDate: 2026-07-24
series: "Behind the Tech: AI"
tags: ["recommendation-system", "machine-learning", "tiktok", "collaborative-filtering", "ai"]
---

Mày cài TikTok lần đầu. Không follow ai, không khai báo sở thích, không có lịch sử gì. Scroll 15 video. Đến video thứ 20, mày đang thấy đúng thứ mày muốn — cooking videos kiểu mày thích, humor phù hợp với sense of humor của mày, không phải người nổi tiếng mà là creator nhỏ có 5000 follow nhưng content hay.

Rồi mày mở Instagram Reels — account đã dùng 3 năm, đã follow 200 người. Recommendations vẫn miss. Vẫn đề xuất những thứ không liên quan.

TikTok cold start từ con số 0 mà đã hiểu mày trong 10 phút. Cái gì đang xảy ra ở đây?

## Cách naive — tại sao nó không work

Cách obvious nhất để biết user thích gì: hỏi họ. Onboarding survey — "Chọn 5 chủ đề mày quan tâm." Rồi recommend content trong những chủ đề đó.

Vấn đề đầu tiên: người ta nói một đằng, xem một nẻo. Mày check "Health & Fitness" vì mày muốn *cảm thấy* mình quan tâm đến sức khỏe. Nhưng thực tế mày scroll qua mọi video gym sau 3 giây. Explicit preference không phản ánh behavior thực tế.

Vấn đề thứ hai: preference thay đổi. Mày ghé TikTok lúc 2 giờ sáng không phải để xem nội dung nghiêm túc. Lúc 7 giờ sáng trên xe bus thì khác. Survey một lần không capture được context.

Vấn đề thứ ba: survey chỉ cho mày biết category, không cho biết style. Trong "cooking" có hàng triệu kiểu content — tutorial nghiêm túc 10 phút, fail video hài hước 30 giây, aesthetic video không nói gì cả. Mày thích cái nào trong số đó?

Hỏi user là dead end. TikTok không hỏi — nó quan sát.

## Cái trick thật sự đằng sau

TikTok track **implicit signals** — những gì mày làm, không phải những gì mày nói. Và signal quan trọng nhất không phải like, không phải comment — mà là **watch completion ratio**.

Mày xem 27 giây của một video 30 giây = 90% completion. Đây là strong positive signal. Mày scroll qua sau 2 giây = strong negative. Mày không nhấn like gì cả nhưng xem đến hết — TikTok biết mày thích video đó. Mày nhấn like nhưng chỉ xem được 30% — TikTok biết cái like đó không thật.

Hierarchy của signals, từ quan trọng nhất:

```
1. Watch completion ratio     ← strongest signal
2. Replay (xem lại)           ← very strong positive
3. Profile visit sau video    ← very strong positive
4. Share                      ← strong positive
5. Comment                    ← positive
6. Like                       ← weaker than people expect
7. Skip < 2s                  ← strong negative
8. "Not interested" button    ← explicit negative
```

Nhưng signals đơn độc không đủ. Cần một pipeline để đi từ tín hiệu đó đến đúng video cho đúng người ở đúng thời điểm — trong khi pool content là hàng tỷ video.

Đây là **two-stage recommendation pipeline**:

```
Toàn bộ video (billions)
        |
        ▼
┌─────────────────────┐
│  CANDIDATE          │
│  GENERATION         │  ← "Những video nào có khả năng phù hợp?"
│  ~1000 candidates   │
└─────────────────────┘
        |
        ▼
┌─────────────────────┐
│  RANKING            │  ← "Trong 1000 candidates, cái nào tốt nhất
│  ML model scoring   │     cho user này, lúc này?"
│  top 10-20 videos   │
└─────────────────────┘
        |
        ▼
     For You Page
```

## Đi sâu hơn — chi tiết kỹ thuật

**Stage 1: Candidate Generation**

Từ hàng tỷ video → lọc xuống ~1000 candidates. Tốc độ là yêu cầu đầu tiên — không thể dùng heavy ML model ở đây. Có hai nguồn candidates chính:

**Collaborative filtering**: "Users giống mày đã xem gì?" Mày và user A có watch history tương tự nhau (cùng xem hết những video về mèo, coding humor, cooking nhất định) → những video user A xem gần đây mà mày chưa xem là candidates tốt.

Về mặt kỹ thuật, đây là matrix factorization: tạo vector embedding cho mỗi user và mỗi video trong không gian latent (ví dụ 128 chiều). Users có sở thích giống nhau có embedding gần nhau trong không gian đó. Candidate retrieval = tìm videos có embedding gần với user embedding — đây là approximate nearest neighbor search, có thể làm rất nhanh với FAISS hay ScaNN.

**Content-based signals**: video mới, video trending theo region, videos từ accounts mày đã interact (dù TikTok de-prioritize follower graph hơn nhiều so với Instagram). Videos từ cùng audio, cùng hashtag, cùng creator style với thứ mày đã xem.

**Stage 2: Ranking**

1000 candidates → ML model score từng cái cho user này. Model này phức tạp hơn nhiều, chạy trên GPU, dùng hàng trăm features:

- User features: lịch sử xem gần đây (weighted by recency), device, location, giờ trong ngày
- Video features: completion rate trung bình của video đó (trên toàn user base), age của video, trending score
- Cross features: mức độ "match" giữa user và video — có những users tương tự đã xem video này không?
- Context: lúc 2 giờ sáng vs 9 giờ sáng mày xem nội dung khác nhau, model biết điều này

Model predict nhiều outcomes: xác suất xem hết, xác suất share, xác suất like, xác suất skip sớm. Rồi combine chúng với trọng số để ra final score. "Watch completion" có trọng số cao nhất.

**Cold start — vấn đề khó nhất**

User mới không có history → collaborative filtering không có gì để làm việc. TikTok giải quyết cold start bằng cách show **diverse content** ban đầu — một mix của viral videos (nhiều người xem → safe bet), trending regional content, và các "representative" videos từ nhiều categories.

Rồi observe: video nào mày xem hết? Video nào mày skip ngay? Chỉ cần 5–10 tín hiệu rõ ràng là model có thể bắt đầu narrow down. TikTok update preferences gần như real-time — sau mỗi video mày xem, For You Page của phiên đó đã điều chỉnh.

Đây là lý do TikTok learn nhanh hơn Instagram Reels: TikTok **thiết kế từ đầu cho cold start** với implicit signal loop nhanh, còn Instagram Reels được build sau và phụ thuộc vào follow graph đã có sẵn.

**Diversity và exploration**

Nếu ranking model tối ưu hoàn toàn cho prediction accuracy, nó sẽ show mày cùng loại content mãi — exploitation không có exploration. TikTok inject một lượng nhỏ "random" content vào feed: video nằm ngoài bubble hiện tại của mày. Nếu mày xem hết → discover sở thích mới. Nếu mày skip → data đó cũng có ích.

## Mày thấy nó ở đâu trong thực tế

**Spotify's Discover Weekly** dùng cùng logic collaborative filtering nhưng trong audio domain. User embedding + song embedding trong latent space, cộng thêm audio features (tempo, key, energy). "Users với taste giống mày trong tuần này nghe gì" → playlist thứ Hai.

**YouTube** có hai feed rất khác nhau: Subscriptions feed (follow graph, chronological) và Home/Recommended (recommendation system tương tự TikTok). Người dùng nặng thường dành nhiều thời gian hơn ở Home dù ít để ý.

**Netflix** dùng recommendation để quyết định không chỉ *gì* để recommend, mà còn *artwork nào* để show cho mày. Thumbnail của cùng một bộ phim có thể khác nhau tùy user — model quyết định ảnh nào làm mày click nhiều nhất dựa trên lịch sử xem.

Điều đáng để hiểu: recommendation system không "biết" mày như một con người hiểu nhau. Nó tìm pattern trong behavior của mày và match với pattern behavior của hàng triệu users khác. Khi nó đúng, nó đúng chính xác một cách đáng sợ. Khi nó sai, nó sai theo kiểu rất mechanical — mày xem một video về bướm vì tò mò, rồi feed bị flood bởi entomology content trong hai ngày.

## Một dòng để nhớ

TikTok không đọc được tâm trí — nó chỉ đo chính xác hơn bất kỳ ai trước đó thứ duy nhất không biết nói dối: mày đã xem đến giây thứ mấy rồi bỏ.

---
*Bài tiếp theo: Tại sao Shopee gợi ý đúng thứ mày vừa tìm kiếm?*
