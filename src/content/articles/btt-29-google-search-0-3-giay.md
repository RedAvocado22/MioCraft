---
title: "Tại sao Google trả về kết quả trong 0.3 giây dù index hàng tỷ trang web?"
description: "Mày search 'python tutorial' và Google trả về 4 tỷ kết quả trong 0.31 giây. Không phải vì server Google siêu nhanh — mà vì nó không bao giờ scan 4 tỷ trang đó."
category: system-design
pubDate: 2026-07-30
series: "Behind the Tech: Search"
tags: ["google", "search", "inverted-index", "pagerank", "distributed-systems", "performance"]
---

Mày gõ "python tutorial" vào Google. Nhấn Enter. 0.31 giây sau, màn hình hiện ra hàng triệu kết quả, xếp theo thứ tự, cái nào cũng liên quan. Google tự hào in dòng chữ nhỏ: "Khoảng 4,230,000,000 kết quả (0,31 giây)".

Bốn tỷ hai trăm ba mươi triệu trang. Trong 310 mili giây. Ở đâu đó trên thế giới, cùng lúc đó có hàng triệu người khác cũng đang search. Làm thế nào cái đó có thể xảy ra?

## Cách naive — tại sao nó không work

Cách đơn giản nhất để tìm kiếm: với mỗi query, quét qua từng trang web trong database, kiểm tra xem trang đó có chứa từ khóa không, rồi trả về danh sách.

Nhân số ra: Google index khoảng 8 tỷ trang. Giả sử mỗi trang check mất 1 mili giây — con số lạc quan phi thực tế. 8 tỷ mili giây = 8 triệu giây = khoảng 92 ngày. Với 1 query. Trong khi Google xử lý 8.5 tỷ query mỗi ngày.

Tuyến tính scan không work ở bất kỳ quy mô nào. Phải có cấu trúc dữ liệu khác.

## Cái trick thật sự đằng sau

Cốt lõi của Google Search — và của mọi search engine — là **Inverted Index**.

**Forward index** là cách tự nhiên mày nghĩ đến: mỗi document lưu danh sách các từ nó chứa.

```
doc_45:   [python, tutorial, beginner, list, loop, function]
doc_1203: [python, advanced, decorator, metaclass, async]
doc_8901: [python, tutorial, project, web, flask, api]
```

Cái này hữu ích để biết document chứa gì, nhưng không hữu ích để tìm document nào chứa một từ.

**Inverted index** đảo ngược lại: mỗi từ lưu danh sách các document chứa nó.

```
"python"   → [doc_45, doc_1203, doc_8901, doc_12044, ...]
"tutorial" → [doc_45, doc_8901, doc_33210, doc_55012, ...]
"beginner" → [doc_45, doc_7801, doc_9923, ...]
```

Query "python tutorial": lấy list của "python", lấy list của "tutorial", tìm **giao** của hai list — documents xuất hiện trong cả hai. Kết quả: [doc_45, doc_8901, ...]. Đây là các trang chứa cả "python" lẫn "tutorial".

Phép intersection hai list đã được sắp xếp là O(n+m) trong đó n, m là độ dài hai list. Cực kỳ nhanh, không liên quan gì đến tổng số trang trong index.

Index này không được xây dựng real-time — **Googlebot crawl** toàn bộ web liên tục (hàng tỷ trang mỗi tháng), xây inverted index offline. Khi mày search, Google không crawl gì cả. Nó chỉ lookup vào index đã có sẵn.

```
Query: "python tutorial"
         |
         ▼
   Inverted Index
   ┌────────────┬──────────────────────────────┐
   │ "python"   │ [doc_45, doc_1203, doc_8901] │
   │ "tutorial" │ [doc_45, doc_8901, doc_33210]│
   └────────────┴──────────────────────────────┘
         |
    intersect
         |
         ▼
   [doc_45, doc_8901] ← candidates
```

## Đi sâu hơn — chi tiết kỹ thuật

**Sharding và fan-out**

Index của Google không nằm trên một máy — nó được **shard** ra hàng nghìn máy chủ. Mỗi máy chứa một phần của index. Khi query đến, nó được **fan-out**: gửi đến tất cả shard đồng thời, mỗi shard trả về kết quả của phần mình, rồi merge lại.

```
Query "python tutorial"
         |
    ┌────┴────┐
    ▼         ▼
 Shard A   Shard B   Shard C ...  (parallel)
    |         |
    └────┬────┘
         ▼
     Merge & Rank
         |
         ▼
     Top 10 results
```

Parallel processing là lý do thật sự khiến query nhanh. Thay vì một máy scan 8 tỷ entry, hàng nghìn máy mỗi cái scan vài triệu entry — đồng thời.

**RAM, không phải disk**

Index trên mỗi shard machine được giữ trong **RAM**. Memory access là nanoseconds. Disk access là microseconds đến milliseconds. Khi có hàng trăm triệu lookup mỗi giây, sự khác biệt đó mang tính sống còn. Google đầu tư rất nhiều vào RAM để đảm bảo hot data không bao giờ phải đọc từ disk trong quá trình serving.

**Two-phase retrieval**

Search không phải chỉ là tìm documents chứa từ khóa — còn phải **xếp hạng**. Google làm điều này theo hai giai đoạn:

**Phase 1 — Recall:** Inverted index trả về top ~1000 candidates cho query.

**Phase 2 — Ranking:** Áp dụng hơn 200 signals lên 1000 candidates đó để chọn ra top 10. Các signals bao gồm:

- **PageRank:** Trang được nhiều trang uy tín khác link đến = trang uy tín hơn. Wikipedia rank cao vì hàng triệu trang link đến nó. Đây là lý do keyword stuffing không đủ — một trang spam chứa đầy "python tutorial" vẫn rank thấp nếu không ai link đến nó.
- **Relevance signals:** Từ khóa xuất hiện trong title, heading, hay trong body? Xuất hiện nhiều lần hay một lần? Đoạn text xung quanh có liên quan không?
- **Freshness:** Bài viết từ tuần trước vs bài viết từ 2019 — với query về news thì freshness quan trọng hơn.
- **Personalization:** Location, search history, ngôn ngữ browser.

Ranking phase chạy trên 1000 documents (không phải hàng tỷ), nên dù phức tạp vẫn nhanh.

**GeoDNS**

0.3 giây bao gồm cả network round-trip. Query của mày không đến datacenter ở Mountain View, California — nó đến **datacenter gần nhất** (ở Việt Nam thường là Singapore hoặc Hồng Kông). GeoDNS tự động route request đến location gần nhất. Network latency từ Hà Nội đến Singapore là ~20-30ms, so với ~200ms đến Mỹ.

Thực tế, processing time thuần của query (inverted index lookup + ranking) chỉ là **10-50ms**. Phần còn lại trong 300ms là network + DNS + TCP handshake + render HTML.

## Mày thấy nó ở đâu trong thực tế

**Elasticsearch** — search engine open-source phổ biến nhất — dùng chính xác cơ chế này. Nếu mày từng xây feature search trong app, khả năng cao mày đang dùng Elasticsearch hoặc một derivative. Nó build inverted index tự động khi mày index documents.

**PostgreSQL full-text search:** Postgres có built-in full-text search dùng inverted index (gọi là GIN index). `tsvector` và `tsquery` là cách Postgres lưu và query inverted index. Nhanh hơn `LIKE '%keyword%'` nhiều bậc, nhưng vẫn thua dedicated search engine ở quy mô lớn vì thiếu distributed sharding.

**Algolia:** Managed search-as-a-service, nhiều startup dùng. Họ tự hào về sub-10ms response vì giữ toàn bộ inverted index trong RAM ở edge nodes trên khắp thế giới.

**GitHub code search:** Tìm kiếm trong hàng tỷ dòng code trên toàn bộ public repos. Dùng trigram index — một biến thể của inverted index, trong đó "token" không phải từ mà là chuỗi 3 ký tự liên tiếp. Cho phép search substring và regex hiệu quả.

## Một dòng để nhớ

Google không search qua hàng tỷ trang khi mày query — nó lookup vào một inverted index đã được xây sẵn và chạy song song trên hàng nghìn máy.

---
*Bài tiếp theo: Tại sao URL shortener như bit.ly redirect gần như instant?*
