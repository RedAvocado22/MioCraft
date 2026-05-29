---
title: "Tại sao Spotify biết mày sẽ thích bài hát mày chưa từng nghe?"
description: "Mỗi thứ Hai, Discover Weekly cho mày 30 bài chưa từng nghe — và ~70% trong số đó đúng trend. Đằng sau là matrix factorization, audio feature vectors, và NLP trên hàng triệu bài blog nhạc."
category: system-design
pubDate: 2026-07-28
series: "Behind the Tech: AI"
tags: ["spotify", "recommendation-system", "matrix-factorization", "audio-analysis", "nlp", "machine-learning"]
---

Mỗi thứ Hai, Spotify gửi cho mày một playlist 30 bài. Mày chưa nghe bài nào trong số đó. Một số là của artist mày chưa nghe tên bao giờ. Thế mà khi play lên, có đến 20 bài mày thấy ổn, 10 bài mày thích thật sự, và 2-3 bài mày không thể tin tại sao Spotify biết mày sẽ thích.

Đây không phải may mắn và không phải Spotify đọc được suy nghĩ của mày. Đây là kết quả của ba signal hoàn toàn khác nhau, được kết hợp với nhau — và không cái nào trong số đó là "AI ma thuật". Câu hỏi là: làm sao một bài nhạc mày chưa từng nghe lại được recommend chính xác đến vậy?

## Cách naive — tại sao nó không work

Cách đơn giản nhất: recommend những bài nhạc đang phổ biến nhất trên Spotify tuần này.

Kết quả: tất cả mọi người nhận cùng một playlist. Người nghe jazz và người nghe metal đều nhận "Shape of You" của Ed Sheeran. Vô nghĩa.

Cải tiến một chút: recommend bài phổ biến nhất trong genre mày hay nghe. Vẫn sai. Người nghe metal có thể nghe cả classical. Người nghe R&B có thể thích một số jazz. Genre label là metadata thủ công, không capture được taste thực tế.

Vấn đề cốt lõi: cả hai cách đều không học từ behavior thực tế của mày — mày nghe gì, bao lâu, bao nhiêu lần, bài nào mày skip sau 10 giây.

## Cái trick thật sự đằng sau

Discover Weekly kết hợp ba signal độc lập, mỗi cái capture một khía cạnh khác của "mày là ai về mặt âm nhạc":

```
Signal 1: Collaborative Filtering
"Những người nghe nhạc giống mày cũng nghe gì?"
          +
Signal 2: Audio Features  
"Bài nhạc này nghe như thế nào về mặt acoustic?"
          +
Signal 3: NLP on Text
"Người ta dùng từ nào để mô tả artist này?"
          ↓
Candidate pool → Reranking → Filter (bỏ bài đã nghe) → 30 bài
```

Ba signal này hoàn toàn độc lập: signal 1 không cần biết bài nhạc nghe thế nào, signal 2 không cần biết ai nghe nó, signal 3 không cần nghe bài nhạc hay biết ai nghe nó. Kết hợp lại thì mạnh hơn bất kỳ signal đơn lẻ nào.

## Đi sâu hơn — chi tiết kỹ thuật

**Signal 1: Matrix Factorization — Collaborative Filtering**

Spotify có khoảng 600 triệu user và 100 triệu bài nhạc. Tưởng tượng một ma trận khổng lồ: mỗi hàng là một user, mỗi cột là một bài nhạc, giá trị là số lần stream (hoặc implicit feedback: play, skip, save).

Ma trận này **cực kỳ sparse** — trung bình mỗi user chỉ nghe vài nghìn bài trong số 100 triệu. 99.999% ô là trống.

**Matrix Factorization** giải quyết bài toán này bằng cách decompose ma trận khổng lồ thành hai ma trận nhỏ hơn:

```
Ma trận gốc R (users × songs) ≈ U × V^T

U: ma trận user factors  (600M users × k dimensions)
V: ma trận song factors  (100M songs × k dimensions)

k thường là 40-200 — "latent dimensions" trừu tượng
không có tên cụ thể, nhưng có thể hiểu gần đúng là
các khía cạnh taste như "energy level", "acoustic vs electronic",
"vocal-centric vs instrumental", v.v.
```

Sau khi train, mỗi user và mỗi bài nhạc được đại diện bởi một vector k chiều. **Dot product** của user vector và song vector cho ra predicted rating của user đó cho bài đó.

```
User mày: [0.8, 0.2, 0.9, 0.1, ...]  (k dimensions)
Bài A:    [0.7, 0.3, 0.8, 0.2, ...]
Dot product: 0.8×0.7 + 0.2×0.3 + 0.9×0.8 + ... = 1.32 (high → recommend)

Bài B:    [0.1, 0.9, 0.1, 0.8, ...]
Dot product: 0.8×0.1 + 0.2×0.9 + ... = 0.41 (low → skip)
```

Điều quan trọng: Spotify dùng **implicit feedback**, không phải explicit rating. Mày không rate bài nhạc — Spotify suy ra từ việc mày có play hết không, có replay không, có add vào playlist không, có skip sau 15 giây không. Đây là data tự nhiên, không cần action thêm từ user.

Matrix factorization được chạy trên distributed cluster (Spotify dùng Apache Spark), mất vài tiếng mỗi tuần. Kết quả là user vectors và song vectors được cập nhật hàng tuần.

**Signal 2: Audio Feature Vectors — Content-based Filtering**

Spotify (thông qua Echo Nest, công ty họ mua năm 2014) phân tích audio của mỗi bài nhạc và extract ra vector đặc trưng:

```
Audio features của một bài nhạc (Spotify API):
  tempo:            128.5 BPM
  energy:           0.87    (0-1, 1 = rất energetic)
  danceability:     0.73    (0-1)
  valence:          0.45    (0-1, mood: 0=buồn, 1=vui)
  acousticness:     0.03    (0-1, 1 = thuần acoustic)
  instrumentalness: 0.61    (0-1, 1 = không có vocal)
  speechiness:      0.04    (ít lời nói, nhiều nhạc)
  liveness:         0.12    (live performance probability)
  loudness:         -5.2 dB
  key:              5       (F major)
  mode:             1       (major/minor)
```

Hai bài nhạc có vector gần nhau (cosine similarity cao) → âm thanh tương đồng → nếu mày thích bài A, bài B là candidate tốt.

Điểm mạnh của signal này: nó không cần bất kỳ user nào nghe bài đó. Một bài nhạc upload hôm nay từ một artist chưa ai biết vẫn có audio features ngay lập tức. Đây là cách Spotify giải quyết **cold start problem** cho bài nhạc mới.

**Signal 3: NLP on Text — Cultural Context**

Cả collaborative filtering lẫn audio features đều bỏ sót một thứ: **ngữ cảnh văn hóa** của âm nhạc. Một bài nhạc có thể có audio features trung tính nhưng được gắn với một subculture rất cụ thể — "emo", "vaporwave", "lo-fi study beats". Audio features không nói lên điều đó.

Spotify crawl hàng triệu nguồn text: blog nhạc, review, tweet, playlist name, Last.fm tags, Reddit thread. Sau đó dùng NLP để extract "cultural fingerprint" của mỗi artist:

```
Các từ thường xuất hiện xung quanh artist X:
  "shoegaze", "dreamy", "ethereal", "wall of sound",
  "My Bloody Valentine", "reverb-heavy", "bedroom pop"
         ↓
Vector từ TF-IDF hoặc Word2Vec trên corpus này
         ↓
Artist X có "cultural vector" gần với artist Y và Z
(dù audio features của họ có thể không giống nhau)
```

Điều thú vị: signal này đôi khi tìm được connections mà hai signal kia bỏ qua. Hai artist có genre hoàn toàn khác nhau nhưng cùng được mô tả trong ngữ cảnh tương tự (cùng review sites, cùng playlist, cùng fan communities) → NLP vector của họ gần nhau → người nghe một artist có thể thích cái kia.

**Kết hợp ba signal**

```
Collaborative Filtering score:  0.78 (user taste)
Audio Feature similarity:        0.65 (sonic similarity)  
NLP cultural similarity:         0.71 (cultural context)
         ↓
Weighted combination → final score: 0.72
         ↓
Rank all songs by score
         ↓
Filter: bỏ bài mày đã nghe, bài đã có trong library
         ↓
Top 30 → Discover Weekly
```

Weights không cố định — Spotify liên tục A/B test để tìm combination tốt nhất cho từng user segment.

**Tại sao thứ Hai?**

Discover Weekly refresh hàng tuần vì đây là sweet spot: đủ thời gian để user nghe hết playlist và cho đủ implicit feedback, nhưng không quá lâu để taste bị stale. Spotify cũng refresh vào đầu tuần khi listening habit thường peak (đầu tuần làm việc).

**Tại sao đôi khi nó miss?**

Khi taste mày thay đổi đột ngột — mày vừa chuyển sang nghe nhạc hoàn toàn khác — matrix factorization cần vài tuần để update user vector của mày. User vector được rebuild hàng tuần từ toàn bộ listening history. Nếu mày vừa nghe 50 bài metal tuần này sau nhiều năm chỉ nghe jazz, user vector vẫn nặng về jazz vì historical data nhiều hơn.

## Mày thấy nó ở đâu trong thực tế

**Daily Mix và Radio:** Dùng cùng infrastructure nhưng real-time hơn và ít strict hơn về "chưa nghe". Daily Mix mix bài quen với bài mới.

**"Because you listened to...":** Đây là item-item collaborative filtering thuần túy — lookup precomputed similar-song list, không cần user vector.

**YouTube Music và Apple Music:** Cùng three-signal approach. Apple Music thêm signal từ iTunes purchase history (rất valuable vì là explicit, không phải implicit).

**Deezer Flow:** Variant thú vị: random walk trên graph của similar artists/songs, nên playlist của mày không lặp lại và có chút surprise.

**Cold start với artist mới:** Bài của một artist 0 stream vẫn có audio features ngay lập tức → có thể appear trong recommendation ngay. Đây là lý do tại sao Spotify tốt hơn đối thủ cho việc khám phá nhạc indie/underground.

## Một dòng để nhớ

Discover Weekly không biết mày thích gì — nó biết hàng triệu người giống mày thích gì, biết bài nhạc nghe như thế nào, và biết người ta nói gì về nó, rồi tìm giao điểm của ba cái đó.

---
*Bài tiếp theo: Tại sao Google trả về kết quả trong 0.3 giây dù index hàng tỷ trang web?*
