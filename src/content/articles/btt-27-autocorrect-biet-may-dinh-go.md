---
title: "Tại sao autocorrect biết mày định gõ gì?"
description: "Mày gõ 'teh' và nó tự đổi thành 'the'. Gõ 'im' thành 'I'm'. Đôi khi sai một cách ngớ ngẩn. Đằng sau là edit distance, keyboard proximity, và một language model chấm điểm từng candidate."
category: system-design
pubDate: 2026-07-27
series: "Behind the Tech: AI"
tags: ["autocorrect", "nlp", "edit-distance", "language-model", "keyboard", "mobile"]
---

Mày gõ "teh" trên điện thoại, nó tự đổi thành "the" trước khi mày kịp nhấn space. Gõ "im tired" thành "I'm tired". Gõ tên một framework mới thì nó autocorrect thành thứ gì đó vô nghĩa, làm mày phải gõ lại ba lần. Cùng một hệ thống, đôi khi thần kỳ, đôi khi ngu đến mức không thể tin được.

Tại sao nó đúng được những cái dễ như "teh" → "the"? Và tại sao nó lại fail với "ngrok" hay tên riêng của mày?

## Cách naive — tại sao nó không work

Cách đơn giản nhất: kiểm tra từ mày gõ có trong dictionary không. Không có → báo lỗi hoặc tìm từ gần nhất theo alphabet.

Vấn đề ngay lập tức: "teh" và "the" cách nhau rất xa trong alphabet, nhưng chúng lại rất gần nhau về mặt gõ phím — chỉ là swap hai ký tự. Dictionary lookup không capture được điều đó.

Thêm nữa: ngữ cảnh hoàn toàn bị bỏ qua. "I want to go their" — "their" là từ có trong dictionary, nhưng sai ngữ pháp trong câu này (nên là "there"). Dictionary lookup không phát hiện được.

Và với autocomplete dự đoán từ tiếp theo (khác với autocorrect fix lỗi) — dictionary không nói gì về "sau từ 'I want to', từ gì có xác suất cao nhất."

## Cái trick thật sự đằng sau

Autocorrect thực tế là một pipeline hai bước: **candidate generation** rồi **candidate scoring**.

```
Mày gõ: "teh"
         |
         v
[Candidate Generation]
  Levenshtein distance ≤ 2:
    "the" (distance 1 — swap t,h)
    "ten" (distance 1 — sub e→n)
    "tee" (distance 1 — sub h→e)
    "tech" (distance 1 — insert c)
    ... (vài chục candidates)
         |
         v
[Keyboard Proximity Filter]
  Trên QWERTY: 'h' và 'e' không kề nhau
  Swap "te" + "h" → "th" + "e" = hoán vị ngón tay
  Score: "the" ↑↑
         |
         v
[Language Model Scoring]
  Context: "I want teh..."
  P("the" | "I want") = 0.31   ← win
  P("ten" | "I want") = 0.04
  P("tech" | "I want") = 0.02
         |
         v
Output: "the" (highest combined score)
```

Hai bước này tách biệt vì lý do performance: candidate generation chạy fast với thuật toán deterministic, language model scoring (tốn kém hơn) chỉ chạy trên danh sách nhỏ candidates đã được lọc.

## Đi sâu hơn — chi tiết kỹ thuật

**Edit Distance (Levenshtein Distance)**

Levenshtein distance đo số lần chỉnh sửa tối thiểu để biến một chuỗi thành chuỗi khác, với ba phép biến đổi: insert, delete, substitute.

```
"teh" → "the":
  Bước 1: swap 'e' và 'h' (thực ra là delete 'e' rồi insert 'e' sau 'h')
  insert 'h' sau 't': "theh" (cost 1)
  delete 'h' cuối:    "the"  (cost 1)
  Total: distance = 2
  
  Hoặc tính theo transposition (Damerau-Levenshtein):
  swap liền kề 'e','h': "the" (cost 1)
  Distance = 1
```

Damerau-Levenshtein bao gồm phép transposition (hoán vị hai ký tự liền kề) — và đây là lý do tại sao nó phổ biến hơn cho typo correction, vì phần lớn lỗi gõ phím là swap hai ký tự kề nhau.

Candidate generation lấy tất cả từ trong dictionary có edit distance ≤ 2. Tại sao 2? Distance 1 bắt được ~80% lỗi gõ phím thông thường. Distance 2 bắt thêm các lỗi nặng hơn mà không làm candidate list quá lớn.

**Keyboard Proximity**

Dictionary lookup với edit distance không phân biệt được "nake" → "make" (n và m kề nhau trên QWERTY) với "nake" → "bake" (n và b cách xa). Nhưng về mặt gõ phím, "nake" → "make" có xác suất lỗi cao hơn nhiều.

```
QWERTY layout (hàng giữa):
  A S D F G H J K L

  'J' kề với: H, K, U, M
  Substitute 'J' → 'H': high probability typo
  Substitute 'J' → 'Z': low probability typo (cách 3 hàng)
```

Keyboard proximity model gán một cost cho mỗi substitution dựa trên khoảng cách vật lý của hai phím. Substitution giữa phím kề nhau có cost thấp → xuất hiện cao hơn trong candidate ranking. Đây cũng giải thích tại sao autocorrect trên điện thoại khác với trên desktop: virtual keyboard layout khác, proximity map khác.

**Phonetic Similarity**

Một số autocorrect system dùng thêm phonetic hashing: biến từ thành chuỗi đại diện cho cách đọc. Soundex, Metaphone là hai thuật toán cổ điển.

```
Soundex của "colour" và "color":
  colour → C460
  color  → C460
  (cùng code → phonetically similar)
```

Hữu ích cho lỗi chính tả mà mày gõ theo âm thanh thay vì chính tả đúng. Ít phổ biến hơn trong mobile autocorrect vì keyboard proximity đã bắt được phần lớn lỗi gõ thực tế.

**Language Model Scoring**

Đây là bước phân biệt autocorrect tốt với autocorrect dở. Cùng input "teh", bước candidate generation cho ra 20 candidates. Bước scoring quyết định cái nào đúng nhất trong ngữ cảnh.

N-gram model tính xác suất của từ dựa trên ngữ cảnh trước nó:

```
Trigram: P(word | prev_word_1, prev_word_2)

"I want ___":
  P("the" | "I", "want")  = 0.031
  P("to"  | "I", "want")  = 0.29
  P("ten" | "I", "want")  = 0.002

"top ___ list":
  P("ten" | "top", "___") = 0.18   ← đây "ten" win
  P("the" | "top", "___") = 0.09
```

N-gram được train từ corpus văn bản lớn (Wikipedia, Common Crawl, ...). Càng nhiều data train → model càng tốt ở common cases.

**Neural language model — tại sao iPhone và Android ngày càng giỏi hơn**

N-gram chỉ nhìn 2-3 từ trước. Transformer-based language model nhìn toàn bộ câu. "I've been to their house many times, I know the way their" → N-gram không biết "their" sai, nhưng transformer nhìn toàn câu và thấy "I know the way ___" → "there" mới đúng.

Kể từ khoảng 2019-2020, cả Android và iOS đều tích hợp on-device neural language model nhỏ cho keyboard. Model này chạy hoàn toàn trên device (privacy), được quantize để fit vào vài trăm MB RAM.

**Tại sao nó sai với "ngrok" hay tên mày**

Cả edit distance lẫn language model đều dựa vào training data. "ngrok" không xuất hiện trong corpus train → language model gán probability gần bằng 0. Bất kỳ từ "bình thường" nào cũng score cao hơn. Kết quả: autocorrect "sửa" một từ đúng thành từ sai.

Giải pháp mà các keyboard app cung cấp: **personal dictionary**. Mỗi lần mày gõ một từ và từ chối autocorrect, từ đó được add vào local vocabulary. Lần sau nó không bị sửa nữa. Đây là một dạng học online đơn giản nhất — update vocabulary dựa trên feedback trực tiếp từ user.

**Autocomplete vs Autocorrect — hai task khác nhau**

Autocorrect: mày đã gõ xong một từ, fix nó nếu sai.
Autocomplete: mày đang gõ dở, gợi ý từ tiếp theo.

Autocomplete chỉ cần bước 2 (language model scoring) mà không cần bước 1 (candidate generation từ edit distance). Nó lấy prefix mày đang gõ, beam search qua language model để tìm top-k completions. "I want to go t..." → "to", "the", "there" là top predictions — vì đây là những từ có P(w | "I want to go") cao nhất bắt đầu bằng "t".

## Mày thấy nó ở đâu trong thực tế

**Gboard (Android) và QuickType (iOS):** Cả hai dùng on-device neural model. Gboard cũng có tính năng sync personal dictionary cross-device (qua Google account), nhưng model weights không được gửi lên server — chỉ có vocabulary.

**Microsoft Word spell check:** Vẫn dùng chủ yếu edit distance + dictionary, nhưng phiên bản mới hơn đã tích hợp neural grammar check (cái gạch chân xanh, không phải đỏ).

**Gmail Smart Compose:** Autocomplete cho email, thuần neural. Không có edit distance ở đây — nó suggest cả phrase "sounds good, see you then" sau khi mày gõ "see you".

**Code editors:** GitHub Copilot là autocomplete cho code, cùng architecture nhưng model lớn hơn nhiều và chạy trên server thay vì on-device.

## Một dòng để nhớ

Autocorrect không tra từ điển — nó generate candidates bằng edit distance, filter bằng keyboard proximity, rồi dùng language model để chọn candidate nào hợp ngữ cảnh nhất.

---
*Bài tiếp theo: Tại sao Spotify biết mày sẽ thích bài hát mày chưa từng nghe?*
