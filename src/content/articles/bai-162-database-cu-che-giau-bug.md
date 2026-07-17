---
title: "Database cũ đang che giấu bug của bạn"
description: "Persistent volume khiến seed thiếu và migration stale không lộ ra. Chỉ một lần dựng stack hoàn toàn sạch mới kiểm tra được môi trường có tái tạo thật sự hay không."
category: system-design
pubDate: 2026-07-17
series: "Phần 12: Production & Ops"
tags: ["docker", "database", "migration", "e2e-testing", "case-study"]
---

E2E chạy xanh nhiều tuần. Sau khi cấu trúc lại repository, team dựng stack mới từ đầu và toàn bộ Saga fail ngay bước tạo contract: user-service trả `404` vì buyer và seller không tồn tại.

Script reset test đã seed product, contract và escrow database — nhưng quên user database. Bug tồn tại từ lâu, chỉ là volume cũ đã có sẵn user nên không ai nhìn thấy.

## Persistent volume là cache của quá khứ

Docker Compose giúp database sống qua nhiều lần restart:

```yaml
services:
  mysql:
    volumes:
      - mysql-data:/var/lib/mysql
```

Đây là behavior đúng cho môi trường dev. Nhưng nó cũng giữ lại:

- row seed từ tháng trước;
- schema tạo thủ công;
- Keycloak realm import cũ;
- migration từng chạy nhưng file hiện tại đã đổi;
- dữ liệu được sửa trực tiếp để debug.

Khi test chạy xanh trên volume đó, bạn đang kiểm tra “hệ thống tiếp tục chạy trên máy này”, không phải “repository có thể dựng lại hệ thống từ con số không”.

## Hai bug chỉ lộ trên môi trường sạch

Ngoài user seed bị thiếu, một script product seed vẫn insert vào cột `category`. Migration mới đã thay cột này bằng `category_id` và bảng category riêng.

Database dev cũ đã được migrate và có dữ liệu hợp lệ nên flow chính vẫn chạy. Nhưng trên database mới:

```text
Flyway tạo schema mới
→ script seed dùng tên cột cũ
→ seed fail
→ listing fixture không tồn tại
→ các request sau fail dây chuyền
```

Một lỗi setup ở đầu suite có thể làm hàng chục test sau đỏ. Nếu chỉ nhìn request cuối, rất dễ debug nhầm vào Saga hoặc RabbitMQ.

## Restart không có nghĩa là clean

Các thao tác này khác nhau:

```bash
docker compose restart       # giữ container và volume
docker compose down          # xóa container, thường vẫn giữ volume named
docker compose down -v       # xóa cả volume của compose project
```

Không nên chạy `down -v` vô thức trên môi trường có dữ liệu cần giữ. Nhưng CI hoặc một profile E2E riêng cần có khả năng tạo database mới, chạy migration, seed fixture và chạy test từ đầu.

## Clean-room test nên kiểm tra gì?

Một pipeline tái tạo môi trường nên làm theo thứ tự:

1. Tạo volume/database mới.
2. Chạy toàn bộ Flyway migration theo đúng thứ tự.
3. Import auth realm hoặc tạo test identity.
4. Chạy seed cho **mọi** service phụ thuộc.
5. Start application và chờ healthcheck.
6. Chạy E2E theo business flow.
7. Chạy lại lần hai để kiểm tra reset script idempotent.

Bước 7 quan trọng: suite chạy được một lần nhưng lần hai fail nghĩa là fixture không được reset đúng hoặc test đang phụ thuộc thứ tự ngầm.

## Đừng dùng production volume để chứng minh reproducibility

Có ba loại môi trường nên tách rõ:

- **Dev volume:** giữ data để làm việc nhanh mỗi ngày.
- **E2E clean volume:** có thể xóa và tạo lại bất kỳ lúc nào.
- **Production/staging volume:** tuyệt đối không tự động xóa; migration phải forward-only và có backup.

Mục tiêu không phải lúc nào cũng bắt developer tải lại mọi thứ. Mục tiêu là luôn có một con đường tự động chứng minh hệ thống tái tạo được.

## Seed cũng là code

Seed script cần được review cùng migration:

- Migration đổi tên hoặc xóa cột → update seed trong cùng change.
- Thêm service dependency → thêm fixture tương ứng.
- ID dùng xuyên service → định nghĩa canonical, không copy ngẫu nhiên.
- Script chạy lại không tạo duplicate hoặc state lệch.

Nếu migration nằm trong CI nhưng seed chỉ tồn tại trong trí nhớ một người, môi trường chưa reproducible.

## Takeaway

Một database dùng lâu ngày có thể làm hệ thống trông ổn hơn thực tế. Dữ liệu cũ lấp chỗ trống cho seed thiếu, schema sửa tay che migration sai, và auth realm cũ che config import hỏng.

Ít nhất trước mỗi mốc release, hãy dựng một stack sạch hoàn toàn. “Chạy được trên máy mình” chỉ có giá trị khi máy mình cũng có thể bắt đầu từ số không.

---

*Bài liên quan: Integration Test — tại sao unit test xanh hết mà vẫn deploy lỗi.*
