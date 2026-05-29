---
title: "N+1 Query — bug thầm lặng giết performance từ từ"
description: "Load 100 user, mỗi user trigger thêm 1 query để lấy orders — là 101 queries thay vì 2. N+1 không gây lỗi, chỉ làm app ngày càng chậm cho đến khi không thể chịu được."
category: system-design
pubDate: 2024-02-23
series: "Phần 6: Database"
tags: ["database", "N+1", "ORM", "performance"]
---

*(Nội dung sắp cập nhật)*
