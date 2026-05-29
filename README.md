# MioCraft

**Code Sống Sót — Từ Project Sinh Viên Đến Production-Ready**

Kiến thức lập trình tiếng Việt viết cho junior dev và sinh viên năm cuối — không phải documentation page, mà là anh senior kể chuyện cho junior nghe. 142 bài, 12 phần, dùng thực tế từ một hệ thống quản lý bệnh viện (Java 17 + Spring Boot 3 + MySQL + Redis).

🔗 **[miocraft.vercel.app](https://techcraft.vercel.app)**

---

## Nội dung

| Phần | Chủ đề |
|------|--------|
| Phần 1 | Tư duy lập trình |
| Phần 2 | Clean Code |
| Phần 3 | Kiến trúc phần mềm |
| Phần 4 | SOLID |
| Phần 5 | Design Patterns |
| Phần 6 | Database |
| Phần 7 | Backend & Hệ thống |
| Phần 8 | System Design |
| Phần 9 | Không phải lúc nào cũng đúng |
| Phần 10 | Case Studies thực tế |
| Phần 11 | Tư duy sản phẩm |
| Phần 12 | Production & Ops |

---

## Tech Stack

- **Framework**: [Astro 5](https://astro.build/) — static output, zero JS overhead
- **Deployment**: [Vercel](https://vercel.com/)
- **Font**: JetBrains Mono
- **Styling**: Vanilla CSS, dark theme, purple accent
- **Search**: Client-side, instant, no backend
- **Read tracking**: localStorage — biết bài nào đã đọc

---

## Chạy local

```bash
git clone https://github.com/RedAvocado22/MioCraft.git
cd MioCraft
npm install
npm run dev
# → http://localhost:4321
```

Build production:

```bash
npm run build
npm run preview
```

---

## Import bài mới

Bài viết là file `.md` trong `src/content/articles/` với frontmatter:

```yaml
---
title: "Tên bài"
description: "Mô tả ngắn"
category: system-design  # hoặc: architecture | programming
pubDate: 2026-06-01
series: "Phần 8: System Design"
tags: ["spring-boot", "redis"]
---
```

Đặt file theo format `bai-NNN-slug.md`, chạy `npm run build` để verify.

---

## License

MIT
