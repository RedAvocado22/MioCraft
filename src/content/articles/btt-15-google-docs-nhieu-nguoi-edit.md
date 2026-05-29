---
title: "Tại sao Google Docs nhiều người edit cùng lúc mà không đè lên nhau?"
description: "Hai người gõ vào cùng một đoạn văn cùng lúc mà không ai bị mất chữ. Không phải locking, không phải merge conflict — Operational Transformation là cái trick đứng sau tất cả."
category: system-design
pubDate: 2026-07-17
series: "Behind the Tech: Real-time"
tags: ["collaboration", "operational-transformation", "crdt", "real-time", "google-docs"]
---

Mày mở một Google Doc, thấy cái cursor màu tím của đồng nghiệp đang nhảy nhảy ở đoạn thứ ba. Mày bắt đầu gõ ở đoạn đầu. Cả hai cùng gõ cùng lúc, chữ hiện ra ngay tắp lự, không ai bị mất gì, không có cái dialog "bản của mày xung đột với bản của người kia". Nó hoạt động mượt đến mức mày không buồn nghĩ đến.

Nhưng thử tưởng tượng cùng một thời điểm, mày chèn chữ vào position 5 của đoạn văn, còn đồng nghiệp mày xóa chữ ở position 7. Hai thay đổi này đi lên server theo thứ tự nào? Và làm sao server đảm bảo khi cả hai được apply, document vẫn đúng — không bị lệch vị trí, không mất chữ, không nhảy loạn xạ?

## Cách naive — tại sao nó không work

Cách đơn giản nhất là **locking**: khi một người đang gõ, người kia bị khóa lại không được chỉnh sửa. Chờ người kia save xong, rồi mới đến lượt mình.

Cách này là thứ mà các hệ thống collaborative cũ — như SharePoint document checkout — từng làm. Và nó tệ theo mọi chiều:

**Latency chết người:** Mỗi keystroke đều phải round-trip lên server để "xin phép" trước khi hiển thị. Ở kết nối 100ms, gõ một chữ mà phải đợi 100ms trước khi thấy nó xuất hiện — không ai chịu được.

**Bottleneck cứng:** Chỉ một người edit tại một thời điểm. Nếu người kia đi pha cà phê mà không release lock, mày ngồi chờ.

**Không scale:** Một document với 20 người online cùng lúc nghĩa là 19 người đang xếp hàng.

Vậy Google Docs làm gì khác?

## Cái trick thật sự đằng sau

Google Docs dùng **Operational Transformation (OT)** — không lock, không chờ đợi. Mọi người gõ ngay lập tức, thay đổi được broadcast, và một thuật toán đặc biệt đảm bảo kết quả cuối cùng của tất cả mọi người là như nhau.

Ý tưởng cốt lõi: thay vì sync **trạng thái** (snapshot của document), sync **operations** — những hành động cụ thể được thực hiện.

Mỗi thay đổi được biểu diễn dưới dạng operation:

```
Insert("X", position=5)   -- chèn chữ "X" vào vị trí 5
Delete(position=3, len=2) -- xóa 2 ký tự bắt đầu từ vị trí 3
```

Khi mày gõ, client của mày tạo ra operation và apply nó **ngay lập tức** vào local document — mày thấy chữ hiện ra tức thì, không cần đợi server. Cùng lúc, operation đó được gửi lên server qua WebSocket.

Vấn đề xảy ra khi hai operations **concurrent** — xảy ra cùng lúc mà chưa biết về nhau:

```
Document ban đầu: "Hello World"
                   0123456789...

User A: Insert("!", position=11)  → "Hello World!"
User B: Insert("?", position=11)  → "Hello World?"
```

Nếu chỉ apply tuần tự không cần transform: A apply xong rồi B apply → "Hello World!?" — đúng. Nhưng nếu B apply trước rồi A apply vào position 11 cũ → "Hello World?!" — thứ tự ngược. Hai client ra kết quả khác nhau.

OT giải quyết bằng **transform function**: khi nhận operation của người khác, biến đổi nó dựa trên operation local đã apply trước đó.

```
                Document gốc
               /             \
   User A gõ "!"           User B gõ "?"
   op_A: Insert("!", 11)   op_B: Insert("?", 11)
               |                     |
         Apply op_A           Apply op_B
               |                     |
   "Hello World!"          "Hello World?"
               \                     /
        nhận op_B              nhận op_A
        transform(op_B, op_A)   transform(op_A, op_B)
        Insert("?", 12)         Insert("!", 11)
               |                     |
   "Hello World!?"         "Hello World!?"
```

Cả hai client ra cùng kết quả. Transform function shift position của op_B lên 1 vì op_A đã chèn một ký tự trước đó.

**Server là arbiter**: Server nhận operations từ tất cả clients, định nghĩa thứ tự canonical, rồi broadcast lại. Mỗi client transform operation nhận được dựa trên operations local đã apply mà server chưa biết.

## Đi sâu hơn — chi tiết kỹ thuật

**Transform function là trái tim của OT** và phải xử lý mọi tổ hợp operation pairs: Insert+Insert, Insert+Delete, Delete+Insert, Delete+Delete. Ví dụ Delete+Delete phức tạp hơn:

```
Document: "Hello World" (11 ký tự)

op_A: Delete(position=6, len=5)  → "Hello "  (xóa "World")
op_B: Delete(position=9, len=2)  → "Hello Wod" (xóa "rl")

Nếu A apply trước, rồi transform op_B:
  "World" đã bị xóa → "rl" không còn tồn tại ở position 9
  transform(op_B, op_A) → No-op (operation bị cancel vì range đã bị xóa)

Kết quả: "Hello " ở cả hai client.
```

**Cursor tracking** — cái ghost cursor của đồng nghiệp mày thấy — cũng là một operation. Vị trí cursor được transform cùng với document operations để nó không nhảy loạn khi người khác chèn text phía trước.

**Operation history** là thứ làm cho undo/redo work trong collaborative context. Khi mày nhấn Ctrl+Z, nó không chỉ đơn giản pop stack — nó tạo ra một **inverse operation** và transform nó qua tất cả operations đã xảy ra sau đó. Undo của mày không undo thay đổi của người khác.

**CRDT — Conflict-free Replicated Data Type** là hướng tiếp cận thay thế, dùng bởi Figma và một số tính năng của Notion. Thay vì transform operations, CRDT dùng cấu trúc dữ liệu toán học đảm bảo **convergence** tự nhiên: bất kể thứ tự apply, kết quả cuối luôn như nhau — không cần transform function, không cần server làm arbiter.

CRDT cho phép **offline editing** tốt hơn: mày có thể edit khi không có mạng, sync sau, document vẫn merge đúng. Nhưng CRDT phức tạp hơn để implement và thường tốn bộ nhớ hơn vì phải lưu metadata cho từng ký tự.

Google Docs dùng OT. Figma dùng CRDT cho thiết kế vector. Hai hướng, cùng mục tiêu.

## Mày thấy nó ở đâu trong thực tế

**Google Docs, Google Sheets, Google Slides** — tất cả đều dùng OT. Collaboration API của Google được gọi là "Operational Transformation service".

**Notion** dùng hybrid: CRDT cho một số loại block, server-authoritative sync cho các phần khác. Đây là lý do Notion đôi khi có conflict state kỳ lạ hơn Google Docs.

**Visual Studio Code Live Share** dùng OT để sync code edits real-time giữa nhiều developer.

**Figma** là ví dụ điển hình của CRDT trong production. Khi nhiều designer kéo cùng một object cùng lúc, Figma dùng thuật toán CRDT để resolve — thường là "last write wins" nhưng per-property, không per-object.

**Yjs và Automerge** là hai CRDT library open-source phổ biến nhất hiện nay, dùng để build collaborative apps mà không cần implement từ đầu.

## Một dòng để nhớ

Google Docs không prevent conflict — nó transform operations để mọi conflict tự resolve thành cùng một kết quả, dù ai gõ trước.

---
*Bài tiếp theo: Tại sao QR code thanh toán hết hạn sau vài phút?*
