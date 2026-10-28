# ML Box Dashboard — kiến trúc MVP hiện tại

Dashboard hiện là web app cho đăng nhập/đăng ký, tài khoản, sandbox và usage/quota.
JupyterHub lùi về vai trò **API-only** (spawn/stop/status qua REST API).

> Tài liệu này ghi trạng thái MVP/single-user hiện tại, không phải target architecture. Kế hoạch project-first và multi-tenant đã được chốt tại [`multi-tenant-product-plan.md`](multi-tenant-product-plan.md); tài liệu đó là nguồn chuẩn cho product model và các phase tiếp theo. Các mục “tương lai” cũ ở dưới cần được hiểu trong bối cảnh MVP ban đầu.

## Quyết định đã chốt (2026-10-27)

| Mục | Lựa chọn |
|---|---|
| Frontend | Next.js (App Router, TypeScript) + HeroUI v3, dùng chung `web/theme/tokens/heroui-tokens.css` |
| Auth | UI tự thiết kế; dashboard gọi BFF same-origin, BFF gọi Cognito `USER_PASSWORD_AUTH` và giữ phiên bằng cookie HttpOnly — không dùng Hosted UI cho trải nghiệm chính |
| JupyterHub API | BFF service riêng giữ Hub service token; browser không bao giờ gọi thẳng Hub |
| Rendering | Cookie locale dùng request-time dynamic rendering; tắt `cacheComponents` và `partialPrefetching` để tránh `DYNAMIC_SERVER_USAGE` trong production |

## Thành phần

```
web/dashboard/   Next.js app (SSR + client)  — login/register/account/sandboxes/usage
web/bff/         Node (Fastify, TypeScript)  — verify Cognito JWT, proxy Hub REST API,
                                               usage/quota endpoints
```

### Luồng

```
Browser ──► mlbox.june8th.me (apex) ──► dashboard (Next.js)
                                            │ same-origin /api/bff/*
                                            ▼
                                  BFF (Fastify, internal :4000)
                                  │ 1) Cognito USER_PASSWORD_AUTH
                                  │ 2) encrypted HttpOnly session + JWKS checks
                                  │ 3) map verified email → Hub username
                                  ▼
                         JupyterHub REST API (/hub/api)
                         token của service "mlbox-bff"
```

- Đăng nhập/đăng ký: dashboard gọi BFF same-origin; BFF gọi Cognito qua **app client
  riêng, không secret**, bật `ALLOW_USER_PASSWORD_AUTH` cùng `ALLOW_USER_SRP_AUTH` và
  `ALLOW_USER_AUTH` cho các flow tương thích. Client OAuth hiện tại của hub
  (`generate_secret=true`, code flow) giữ nguyên cho JupyterHub.
- Sau khi đăng nhập ở dashboard, dashboard đổi access token lấy phiên JupyterHub:
  BFF gọi hub API spawn server; user mở notebook qua link `notebook.mlbox.june8th.me`
  (hub vẫn dùng Cognito OIDC nên SSO liền mạch trong cùng user pool).

### Hub service cho BFF

`03-hub-app` sinh token riêng trong Terraform state nhạy cảm và cấu hình service
`mlbox-bff` cùng các scope cần thiết (`list:users`, `read:users:name`,
`read:servers`, `admin:servers`). `04-dashboard` đọc output nhạy cảm này và
inject vào Kubernetes Secret `bff-config`; token không đi vào image hoặc browser.

Các secret vẫn tồn tại trong Terraform state và Kubernetes Secret, vì vậy backend
state phải bật encryption/versioning/locking và cần review Secrets Manager ở bước
hardening tiếp theo.

### Usage/quota

- MVP đọc realtime từ Hub REST API (`GET /hub/api/users/<username>`): server state,
  `last_activity` và resource metadata nếu Hub trả về.
- Quota policy được inject vào BFF runtime qua Terraform: `32 CPU-hours`, `24 GB RAM`,
  `20 GB storage`, `0 GPU-hours`.
- CPU-hours và storage usage không được suy diễn từ `last_activity` hoặc server state;
  API trả `null` và UI hiển thị trạng thái chưa tracking/chưa có dữ liệu.
- RAM footprint chỉ được cộng khi resource metadata hợp lệ; thiếu metadata trả `null`.
- Kỳ 2 (khi có GPU + kế toán): ghi nhận GPU-hours trong spawn hook vào bảng riêng
  trong hub DB (Postgres RDS) — BFF đọc qua hub API, không truy cập DB trực tiếp.

## Hạ tầng (stack `04-dashboard`, đã fresh apply)

- Terraform định nghĩa ECR immutable cho `dashboard` + `bff`.
- Namespace `dashboard` có Dashboard Deployment/Service/TargetGroupBinding và
  BFF Deployment/Service/Secret nội bộ; ALB host-header rule dùng apex
  `mlbox.june8th.me` và ACM certificate từ `00-bootstrap` (được `02-platform`
  tham chiếu).
- BFF chỉ được gọi từ Next.js qua `BFF_INTERNAL_URL`; Hub service token và session
  secret chỉ inject lúc runtime.
- Lỗi production `DYNAMIC_SERVER_USAGE` đã được xử lý trong code bằng cách tắt
  `cacheComponents`/`partialPrefetching`; isolated production build/start trả 200.
  ALB target đã healthy và Cognito resources đã được apply; authenticated Cognito/Hub
  end-to-end vẫn cần test bằng test user.
- `mlbox.june8th.me` đã được delegate về Route53; cả hai ACM certificate đã `ISSUED`.
  DNS/ACM không cần thao tác lại khi chỉ rollout application stack.
- Chi tiết lệnh deploy và kiểm tra nằm trong [`docs/DEPLOYMENT.md`](DEPLOYMENT.md)
  và [`docs/OPERATIONS.md`](OPERATIONS.md).

## Cognito cần chỉnh (module auth)

- App client mới `dashboard`: `generate_secret = false`,
  `explicit_auth_flows` thêm `ALLOW_USER_SRP_AUTH`, `ALLOW_USER_AUTH`
  (cho confirm/forgot), scopes giữ openid/email/profile.
- User pool giữ `allow_admin_create_user_only = false` (self-signup) — dashboard
  dùng chính flow đăng ký của Cognito.

## Lộ trình và trạng thái

Kế hoạch chuyển từ sandbox-first sang Space → Team → Project được theo dõi trong
[`multi-tenant-product-plan.md`](multi-tenant-product-plan.md) và [`TODO.md`](../TODO.md).
Các trạng thái dưới đây chỉ ghi nhận MVP đã triển khai/xác nhận tại thời điểm tài liệu
được cập nhật; không có nghĩa các phần multi-tenant đã tồn tại.

1. ✅ Auto light/dark trong notebook (`adaptive-theme` trong `overrides.json`,
   image `cpu:dev-fa3b6fa-v5`).
2. ✅ `web/dashboard` có UI scaffold; auth và sandbox list/start/stop đã nối vào BFF.
3. ✅ `web/bff` có source Fastify, Cognito signup/confirm/login/logout, encrypted
   HttpOnly session, JWKS verification và per-user Hub proxy.
4. ✅ Terraform đã apply Cognito password flow, Hub service token/role và
   Dashboard+BFF workload; pods và ALB targets đang healthy.
5. ✅ Lỗi `DYNAMIC_SERVER_USAGE` đã được sửa và verify `/`/`/login` qua ALB;
   authenticated Cognito và sandbox vẫn cần test với AWS thật bằng test user.
6. ✅ Usage/quota MVP đã nối BFF và Hub realtime footprint; historical accounting,
   account, tạo/đổi tên sandbox vẫn là các hạng mục tiếp theo. GPU accounting chỉ làm
   sau khi có quota và policy.

Checklist chi tiết được duy trì tại [`TODO.md`](../TODO.md).
</content>
