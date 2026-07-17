---
title: "Feature flag — deploy code mà chưa bật feature"
description: "Merge liên tục lên main, ship binary hàng ngày, bật tính năng bằng flag — rollout 5% trước khi mở cho toàn bộ clinic."
category: programming
pubDate: 2026-05-29
series: "Phần 12: Production & Ops"
tags: ["production", "feature-flag", "deploy", "trunk-based"]
---

Product muốn demo luồng đặt lịch mới cho sếp thứ Sáu. Dev team merge PR thứ Tư — nhưng **không muốn** bệnh nhân thật thấy UI mới cho đến khi QA xong. Cách cũ: giữ branch riêng hai tuần, merge cuối tuần, pray. Cách production: **code đã nằm trên main và đã deploy**, nhưng cờ `new-booking-flow` vẫn `false` trên prod.

Đó là feature flag — không phải “tắt server”, mà tách **deploy** (đưa code lên) khỏi **release** (cho user dùng).

---

## Trunk-based dev và vì sao flag không phải luxury

**Trunk-based development** nghĩa là mọi người merge nhỏ, thường xuyên, vào một nhánh chính (`main`). Branch sống lâu → merge conflict khổ, diff khó review, “big bang release” cuối tháng.

Vấn đề: làm sao merge code chưa xong mà không phá prod? Flag.

- Code path mới bọc trong `if (flags.isEnabled("new-booking-flow", userId))`
- Mặc định `false` trên prod → user thấy flow cũ
- Khi sẵn sàng: bật flag, không cần deploy lại (hoặc chỉ đổi config)

Một lỗi thường gặp là: *“Flag = comment code bằng if”*. Khác ở chỗ flag **đổi runtime** — từ dashboard, env, hoặc service như Unleash/LaunchDarkly — không cần build image mới.

---

## Rollout từng phần — không phải on/off toàn hệ thống

Bật 100% ngay lập tức cho feature lớn là cược. Pattern an toàn hơn:

1. **Internal / staff only** — chỉ role `ADMIN` hoặc clinic test
2. **Percentage rollout** — hash `userId` (hoặc `clinicId`) vào bucket 5% → 25% → 100%
3. **Kill switch** — một nút tắt khi error rate tăng, không rollback deploy

```java
@Service
@RequiredArgsConstructor
public class FeatureFlagService {

  private final Unleash unleash; // hoặc custom DB + cache

  public boolean isNewBookingFlow(UUID userId) {
    UnleashContext ctx = UnleashContext.builder()
        .userId(userId.toString())
        .build();
    return unleash.isEnabled("new-booking-flow", ctx);
  }
}
```

```java
// AppointmentController — cùng endpoint, hai implementation
public AppointmentResponse book(BookRequest req) {
  UUID patientId = UserContext.getCurrentUserId();
  if (featureFlags.isNewBookingFlow(patientId)) {
    return newBookingService.book(req);
  }
  return legacyBookingService.book(req);
}
```

Hash theo `userId` giúp **cùng một user** luôn thấy cùng variant (không lúc mới lúc cũ mỗi request).

---

## Pitfall thật — đừng để flag sống mãi

Flag là **nợ kỹ thuật có chủ đích**. Quên xóa sau khi rollout xong → codebase như hai app chồng nhau, test matrix nổ.

Quy tắc team HMS:

- Mỗi flag có **owner** và **ngày hết hạn** trong ticket
- Sau 100% + một sprint ổn định: xóa nhánh `if`, xóa flag config
- Không flag mọi thứ — chỉ feature có risk cao hoặc cần A/B

Flag **không thay** integration test. Code path tắt vẫn phải compile và có test (hoặc xóa hẳn trước merge nếu chưa ready — tùy policy team).

---

## Takeaway

Trước khi giữ branch dài vì “chưa release”: hỏi feature có thể bọc flag và merge vào main với default `off` không. Rollout 5% clinic trước khi mở toàn quốc — và đặt lịch xóa flag trong backlog, không để nó trở thành permanent `if`.

---

*Bài tiếp theo: Blue-green vs rolling deploy — zero-downtime strategy*
