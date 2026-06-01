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

> **TL;DR:** Spotify dùng ba nguồn thông tin cùng lúc: **(1)** người có taste giống mày nghe gì, **(2)** bài nhạc này nghe như thế nào về mặt âm thanh, **(3)** cộng đồng dùng từ gì để mô tả artist. Giao điểm của ba cái đó = Discover Weekly.

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

## Nếu bạn muốn hiểu sâu hơn _(đọc thêm, không bắt buộc)_

**Signal 1: Collaborative Filtering — "Người giống mày thích gì?"**

> **Hãy tưởng tượng:** Một bảng điểm khổng lồ — 600 triệu hàng (users) × 100 triệu cột (bài nhạc). Mỗi ô là số lần user đó nghe bài đó. Hầu hết ô là trống vì không ai nghe hết 100 triệu bài.

Spotify dùng thuật toán **matrix factorization** để "điền vào ô trống" — dự đoán: "nếu user này nghe bài kia, họ sẽ nghe mấy lần?"

Kết quả: mỗi user được đại diện bởi một "hồ sơ âm nhạc" với ~100 con số — không có tên cụ thể, nhưng đại diện cho taste như "năng lượng cao vs thấp", "acoustic vs electronic", "có lời vs nhạc không lời". Mỗi bài nhạc cũng có hồ sơ tương tự. **Hồ sơ của mày càng giống hồ sơ của bài nhạc → bài đó càng được recommend**.

Điều quan trọng: Spotify không hỏi mày thích hay không. Nó suy ra từ hành vi thực: play hết vs skip sau 15 giây, replay, add vào playlist. Tự nhiên hơn, chính xác hơn.

Matrix factorization chạy trên cluster lớn, mất vài tiếng mỗi tuần. Hồ sơ của mày được cập nhật hàng tuần dựa trên lịch sử nghe nhạc.

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

**Signal 3: NLP — "Người ta nói gì về artist này?"**

Audio features không nói lên ngữ cảnh văn hóa: một bài có thể có âm thanh trung tính nhưng gắn chặt với subculture "vaporwave" hay "lo-fi study beats". Signal 3 capture điều đó.

Spotify crawl hàng triệu blog nhạc, review, tweet, playlist name, Reddit thread — và tìm những từ **thường xuất hiện xung quanh từng artist**. Artist X được nhắc cùng "shoegaze, dreamy, ethereal, bedroom pop" → nó có "dấu ấn văn hóa" riêng. Artist Y có cùng dấu ấn → hai artist này nằm gần nhau trong không gian recommendation.

Thú vị nhất: signal này đôi khi tìm ra connections mà hai signal kia bỏ sót — hai artist genre hoàn toàn khác nhau nhưng cùng xuất hiện trên cùng review sites, cùng playlist, cùng fan communities.

**Kết hợp ba signal:**

```
Signal 1 (user taste):       điểm cao
Signal 2 (sonic similarity): điểm cao
Signal 3 (cultural context): điểm cao
         ↓
Tổng hợp → xếp hạng toàn bộ bài nhạc
         ↓
Bỏ bài mày đã nghe, bài trong library
         ↓
Top 30 → Discover Weekly
```

Tỷ lệ đóng góp của 3 signal không cố định — Spotify liên tục A/B test để tìm công thức tốt nhất cho từng nhóm user.

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
