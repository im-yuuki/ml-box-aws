# ML Box Dashboard — kiến trúc (đã chốt hướng)

Một web duy nhất thay thế trải nghiệm JupyterHub hub pages: đăng nhập/đăng ký,
quản lý tài khoản, quản lý sandbox và theo dõi usage/quota. JupyterHub lùi về
vai trò **API-only** (spawn/stop/status qua REST API).

## Quyết định đã chốt (2026-10-23)

| Mục | Lựa chọn |
|---|---|
| Frontend | Next.js (App Router, TypeScript) + HeroUI v3, dùng chung `web/theme/tokens/heroui-tokens.css` |
| Auth | UI tự thiết kế trong dashboard, gọi Cognito trực tiếp (SRP, OTP) — không dùng Hosted UI cho trải nghiệm chính |
| JupyterHub API | BFF service riêng giữ hub admin token; browser không bao giờ gọi thẳng hub |

## Thành phần

```
web/dashboard/   Next.js app (SSR + client)  — login/register/account/sandboxes/usage
web/bff/         Node (Fastify, TypeScript)  — verify Cognito JWT, proxy Hub REST API,
                                               usage/quota endpoints
```

### Luồng

```
Browser ──► mlbox.june8th.me (apex) ──► dashboard (Next.js)
                │                         │
                │                         ▼
                └──────────────────► BFF /api/*
                                          │ 1) verify JWT (Cognito JWKS)
                                          │ 2) map user → hub username (email)
                                          ▼
                              JupyterHub REST API (hub.hub.svc:8081)
                              token của service "dashboard" (admin)
```

- Đăng nhập/đăng ký: dashboard gọi Cognito qua **app client riêng, không secret**,
  bật `ALLOW_USER_SRP_AUTH` (+ confirm/forgot password). Client OAuth hiện tại của
  hub (`generate_secret=true`, code flow) giữ nguyên cho JupyterHub.
- Sau khi đăng nhập ở dashboard, dashboard đổi access token lấy phiên JupyterHub:
  BFF gọi hub API spawn server; user mở notebook qua link `notebook.mlbox.june8th.me`
  (hub vẫn dùng Cognito OIDC nên SSO liền mạch trong cùng user pool).

### Hub service cho BFF

Thêm vào `hub-values.yaml.tpl`:

```yaml
hub:
  config:
    JupyterHub:
      services:
        dashboard:
          api_token: <từ Secret>   # BFF giữ, không render vào values
          admin: true              # cần quyền spawn/stop/list user servers
```

Token cấp qua Secret trong cluster (04-dashboard stack), không hard-code.

### Usage/quota

- Nguồn kỳ 1: hub REST API (`GET /hub/api/users`, server state, last_activity)
  + cấu hình quota trong values/profile (CPU profile hiện tại: 2 CPU / 4G RAM).
- Kỳ 2 (khi có GPU + kế toán): ghi nhận GPU-hours trong spawn hook vào bảng riêng
  trong hub DB (Postgres RDS) — BFF đọc qua hub API, không truy cập DB trực tiếp.

## Hạ tầng (stack mới `04-dashboard`, chưa apply)

- ECR repo `dashboard` + `bff` (module ecr mở rộng).
- Deployment + Service trong cluster (namespace `hub` hoặc `dashboard`), chạy trên
  NodePool `cpu-user`.
- Cùng ALB hiện có: host **apex `mlbox.june8th.me`** (ACM cert mới cho apex, SAN chỉ
  gồm apex) → listener rule host-header forward về dashboard Service; hub giữ default
  action. BFF là ClusterIP nội bộ, dashboard gọi trong cluster.
- DNS: đã delegate `mlbox.june8th.me` về Route53 → thêm record A apex (alias → ALB).

## Cognito cần chỉnh (module auth)

- App client mới `dashboard`: `generate_secret = false`,
  `explicit_auth_flows` thêm `ALLOW_USER_SRP_AUTH`, `ALLOW_USER_AUTH`
  (cho confirm/forgot), scopes giữ openid/email/profile.
- User pool giữ `allow_admin_create_user_only = false` (self-signup) — dashboard
  dùng chính flow đăng ký của Cognito.

## Lộ trình

1. ✅ Auto light/dark trong notebook (`adaptive-theme` trong `overrides.json`,
   image `cpu:dev-fa3b6fa-v5`).
2. Scaffold `web/dashboard` + `web/bff`, chạy local với hub API mock.
3. Terraform: Cognito client dashboard + hub service/token + ECR repos.
4. Dockerfile + deploy `04-dashboard` (ALB rule host apex, DNS record apex).
5. Nối dashboard với hub thật, verify end-to-end (đăng ký → spawn → mở Lab).
6. Usage/quota views; GPU accounting (giai đoạn GPU).
</content>