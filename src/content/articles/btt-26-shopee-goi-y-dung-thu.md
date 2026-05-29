---
title: "Tại sao Shopee gợi ý đúng thứ mày vừa tìm kiếm?"
description: "Mày search 'tai nghe' một lần, hôm sau homepage toàn tai nghe. Không phải Shopee đọc được tâm trí — đó là collaborative filtering và real-time session signals phối hợp với nhau."
category: system-design
pubDate: 2026-07-26
series: "Behind the Tech: AI"
tags: ["recommendation-system", "collaborative-filtering", "e-commerce", "machine-learning", "shopee"]
---

Mày vào Shopee, search "tai nghe", click vào 3 sản phẩm, rồi đóng app lại không mua gì. Hôm sau mở lại, homepage toàn tai nghe. Không phải tai nghe bất kỳ — mà đúng loại mày đã xem, cộng thêm một mớ sản phẩm liên quan mà mày chưa biết mình muốn, nhưng nhìn vào lại thấy hợp lý một cách khó chịu.

Shopee không đọc được suy nghĩ của mày. Nhưng nó biết một điều khác — hàng triệu người đã làm chính xác cái mày vừa làm trước mày. Và từ đó, nó suy ra cái mày nhiều khả năng sẽ làm tiếp theo. Câu hỏi là: cơ chế nào cho phép nó làm điều đó ở quy mô hàng triệu user?

## Cách naive — tại sao nó không work

Cách đơn giản nhất: mày search "tai nghe" → hệ thống lưu lại category "Electronics > Headphones" → lần sau vào thì show sản phẩm trong category đó.

Vấn đề đầu tiên là nó quá nông. Cùng category "tai nghe" có thể là tai nghe gaming $5 Trung Quốc hoặc Sony WH-1000XM5 giá 7 triệu. Hai người tìm cùng keyword nhưng budget và nhu cầu khác nhau hoàn toàn — show cùng một danh sách là vô nghĩa.

Vấn đề thứ hai: category-based filtering bỏ qua cross-category signal. Người mua tai nghe gaming thường cũng mua mic, bàn phím cơ, ghế gaming. Người mua tai nghe chạy bộ thường mua đồ thể thao. Category không capture được pattern này.

Vấn đề thứ ba: nó chỉ phản ứng với lịch sử mày, không học từ hàng triệu người dùng khác. Đó là lãng phí tài nguyên khổng lồ.

## Cái trick thật sự đằng sau

Shopee dùng ba lớp signal kết hợp, mỗi lớp có vai trò khác nhau.

**Lớp 1: Session-based signals — realtime**

Trong phiên hiện tại, mọi thứ mày click có trọng số rất cao. Search "tai nghe" → xem 3 sản phẩm → sản phẩm thứ 3 xem lâu nhất → hover vào reviews → đây là signal mạnh nhất, và nó được xử lý gần như ngay lập tức.

```
Session hiện tại của mày:
  search: "tai nghe"
  view: Sony WH-1000XM4 (12 giây)
  view: JBL Tune 510BT (4 giây)
  view: Sony WH-1000XM4 (quay lại, thêm 25 giây)
         ↓
  Real-time feature store cập nhật:
  "user đang quan tâm tai nghe Sony cao cấp, wireless"
         ↓
  Boost ngay lập tức: Sony WH-1000XM5, MDR-1AM2, WF-1000XM4
```

Đây là **real-time feature store** — một hệ thống lưu trữ in-memory (thường là Redis hoặc tương đương) các feature của user trong session, cập nhật theo từng action. Latency tính bằng milliseconds.

**Lớp 2: Item-based Collaborative Filtering — precomputed**

Đây là backbone của hầu hết recommendation system thương mại điện tử. Logic: tính toán sự tương đồng giữa các sản phẩm dựa trên hành vi mua hàng của toàn bộ user base.

```
Ma trận purchase history (đơn giản hóa):

              tai nghe  mic  bàn phím  ghế gaming  dây sạc
user_A            1      1      1          0           0
user_B            1      0      1          1           0
user_C            1      1      0          1           0
user_D            0      0      1          0           1
                  ↓
Item-item similarity matrix (tính offline, batch):
tai nghe ↔ mic:         0.72
tai nghe ↔ bàn phím:    0.61
tai nghe ↔ ghế gaming:  0.58
tai nghe ↔ dây sạc:     0.11
```

Kết quả: khi mày xem tai nghe, hệ thống lookup bảng similarity này (đã precomputed) và lấy ra top-k items tương đồng nhất. **Không cần tính toán gì thêm lúc inference** — đây là lý do tại sao gợi ý hiện ra tức thì. Computation nặng được làm offline, hàng đêm.

**Lớp 3: User-based Collaborative Filtering — personalized**

Thay vì so sánh sản phẩm với sản phẩm, cách này so sánh user với user: tìm những người có lịch sử mua hàng gần giống mày nhất, rồi gợi ý những thứ họ mua mà mày chưa mua.

Đây là lý do tại sao đôi khi Shopee gợi ý thứ gì đó hoàn toàn không liên quan đến thứ mày vừa search, nhưng lại chính xác một cách kỳ lạ — vì hàng trăm user có profile giống mày đã mua thứ đó.

User-based CF tốn kém hơn item-based ở inference time vì phải tìm similar users trong real-time. Shopee giải quyết bằng cách precompute "user neighbor list" theo batch, cập nhật hàng ngày.

## Đi sâu hơn — chi tiết kỹ thuật

**Co-occurrence matrix — mục "Đã xem cùng"**

Cái section "Người mua cũng xem" hoặc "Sản phẩm thường được xem cùng" không dùng purchase data — dùng session co-occurrence. Nếu trong cùng một session, users thường xem sản phẩm A rồi xem sản phẩm B, hai sản phẩm này có co-occurrence score cao.

```
Session logs (tất cả user, 30 ngày):
  session_1: [product_A, product_B, product_C]
  session_2: [product_A, product_D, product_B]
  session_3: [product_B, product_E]
              ↓
Co-occurrence:
  A-B: 2  (xuất hiện cùng session 2 lần)
  A-C: 1
  A-D: 1
  B-C: 1
  B-D: 1
```

Đây là signal khác với purchase history: nó capture intent, không phải transaction. Người xem A và B cùng session đang so sánh — ngay cả khi cuối cùng không mua cái nào.

**Real-time vs Batch — hai vòng lặp chạy song song**

Shopee (và mọi e-commerce lớn) chạy hai pipeline hoàn toàn tách biệt:

- **Real-time pipeline**: cập nhật session features theo từng event, latency < 100ms. Ảnh hưởng đến ranking trong session hiện tại.
- **Batch pipeline**: chạy hàng đêm, xử lý toàn bộ purchase/view history, rebuild item-item similarity matrix, user neighbor list. Job này có thể chạy hàng tiếng trên cluster Spark hoặc tương đương.

Hai pipeline này cho phép Shopee vừa phản ứng tức thì với behavior trong session hiện tại, vừa dùng được toàn bộ historical data.

**Trang category cũng được personalize**

Khi mày vào trang "Điện tử & Điện thoại", thứ tự sản phẩm hiện ra không giống người khác. Cùng category page, nhưng user có lịch sử mua Android thấy điện thoại Android lên đầu, user hay mua phụ kiện gaming thấy chuột và tai nghe gaming lên trước. Ranking model (thường là LambdaRank hoặc một variant của Learning to Rank) được feed cả user features lẫn item features để quyết định thứ tự.

**A/B testing — hàng trăm experiments chạy cùng lúc**

Không có một thuật toán duy nhất nào chạy cho tất cả user. Shopee (cũng như Lazada, Tiki, Amazon) liên tục chạy A/B test: nhóm user này thấy item-based CF, nhóm kia thấy neural collaborative filtering, nhóm khác thấy kết hợp. Metric theo dõi là CTR (click-through rate), conversion rate, và GMV. Experiment nào win thì được rollout thêm traffic. Đây là lý do tại sao recommendation của Shopee không ngừng thay đổi — nó đang học từ mày ngay cả khi mày không biết mình đang là "thí nghiệm".

## Mày thấy nó ở đâu trong thực tế

**Tiki, Lazada, Amazon:** Cùng architecture, khác ở scale và data volume. Amazon được coi là pioneer của item-based CF — họ publish paper về nó năm 2003, và nó vẫn là nền tảng của hầu hết e-commerce recommendation đến hôm nay.

**TikTok For You Page:** Cũng collaborative filtering nhưng signal là watch time thay vì purchase, và content thay vì product. Tương đồng đến mức đáng sợ.

**Netflix "Người dùng cũng xem":** Item-based CF thuần túy, nhưng signal là rating và watch history thay vì purchase.

**Cái mày không thấy:** Phần lớn computation xảy ra offline. Cái mày thấy trong 100ms khi scroll homepage là kết quả của một pipeline chạy hàng tiếng đêm qua.

## Một dòng để nhớ

Shopee không gợi ý thứ mày muốn — nó gợi ý thứ hàng triệu người giống mày đã muốn, với item-based CF làm nền tảng và session signal làm lớp real-time bên trên.

---
*Bài tiếp theo: Tại sao autocorrect biết mày định gõ gì?*
