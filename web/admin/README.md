# MLBox Admin Console

Dashboard vận hành chỉ-đọc cho **một quản trị viên duy nhất**. Tách hoàn toàn khỏi dashboard khách hàng:
không dùng Cognito, không dùng BFF, có hostname, image, ServiceAccount và IAM role riêng.

```
web/admin/       Fastify (TypeScript): đăng nhập, API chỉ-đọc, phục vụ bản export của UI
web/admin/ui/    Next.js static export: giao diện, dùng chung design system với web/dashboard
```

## Trang

| Trang | Nguồn dữ liệu |
|---|---|
| Overview | probe HTTP tới BFF, dashboard, Hub; Postgres; Kubernetes API |
| Sandboxes | Postgres (`mlbox_sandboxes`, `mlbox_usage_sessions`) |
| Users | Postgres: tìm theo email, tên hoặc ID, kèm Space, gói, units tháng này |
| Audit | `mlbox_audit_events` và nhật ký thao tác của chính console |
| Deployments | Kubernetes API: workload, image tag, PVC |
| AWS infrastructure | EKS, EC2, ELB, ACM, Route 53, RDS, EFS, S3, Cognito, xếp theo tầng |
| Cost | Cost Explorer, chỉ khi `enable_cost_explorer = true` |

Mỗi nguồn lỗi độc lập: thiếu quyền hoặc mất kết nối chỉ làm hỏng thẻ đó, không làm hỏng cả trang.

## Ngôn ngữ thiết kế (thống nhất với dashboard)

UI dùng đúng bộ kit của `web/dashboard`, không tự vẽ component:

| Lớp | Dùng |
|---|---|
| Component | HeroUI v3 (`@heroui/react`): Card, Chip, Table, Button, Form/TextField, Select, Drawer, Alert, Toast, Spinner |
| Style | Tailwind v4 + `@heroui/styles`, cấu hình Turbopack giống dashboard |
| Màu, bo góc, motion | `web/theme/tokens/heroui-tokens.css` (nguồn duy nhất). Bản sao ở `ui/src/styles/`, test fail nếu lệch |
| Shell | Cùng lớp `workspace-*` của dashboard: navbar, page heading, nền lưới. Bảy mục điều hướng nằm ở cột trái (`admin-sidebar`), thu thành một hàng cuộn được trên điện thoại |
| Icon | `lucide-react` |
| Font | Geist / Geist Mono |
| Giao diện | Theme sáng/tối/theo hệ thống qua `[data-theme]` (khóa `mlbox-theme`), drawer cài đặt giống dashboard |
| Ngôn ngữ | `next-intl`, en và vi, cùng khóa lưu `mlbox-locale`; test kiểm hai file message có đúng cùng khóa |
| Lỗi và phản hồi | `FeedbackAlert` (lỗi inline, thành công bằng toast), `CardSectionTitle` (h2 có dáng của card) |

Quy tắc: không thêm màu vào CSS của console (test fail nếu có hex/rgb/oklch). Cần màu mới thì thêm token vào
`web/theme/tokens/heroui-tokens.css` trước, rồi copy:

```bash
cp web/theme/tokens/heroui-tokens.css web/admin/ui/src/styles/heroui-tokens.css
```

Component chia sẻ (`BrandMark`, `FeedbackAlert`, `CardSectionTitle`, `Toaster`, `LocaleFlag`, `useTheme`, `SettingsDrawer`)
được sao nguyên từ dashboard vì repo chưa có workspace dùng chung; khi sửa ở một bên, sửa cả bên kia.

## Đăng nhập

- Tên đăng nhập và hash mật khẩu (scrypt) nằm trong Kubernetes Secret `admin-config`, do Terraform tạo.
- Phiên là cookie `HttpOnly`, `SameSite=Strict`, `Secure`, ký HMAC bằng secret riêng, hết hạn sau 8 giờ.
- Sai 5 lần trong 15 phút thì khóa địa chỉ đó 15 phút (lưu trong bộ nhớ tiến trình, nên chỉ chạy 1 replica).
- Đổi mật khẩu: tạo hash mới, cập nhật `admin_password_hash`, apply `07-admin`.

```bash
cd web/admin
npm ci && npm run build
ADMIN_PASSWORD='một cụm mật khẩu dài' npm run hash-password
```

## Bảo mật phía trình duyệt

- UI là file tĩnh đọc một lần lúc khởi động và phục vụ theo bảng đường dẫn chính xác, nên request không thể trỏ tới file khác.
- CSP theo trang: `script-src 'self'` cộng hash SHA-256 của các script inline do Next.js sinh ra, không dùng `unsafe-inline` cho script.
  `style-src` có `unsafe-inline` vì HeroUI và React Aria ghi thuộc tính `style`.
- Mọi lệnh ghi (đăng nhập, đăng xuất) cần header `X-Requested-With: mlbox-admin`, ngoài cookie `SameSite=Strict`.

## Quyền

- **AWS:** IAM role `<cluster>-admin-console` gắn vào ServiceAccount qua IRSA, chỉ có các quyền `Describe*`/`List*`
  (xem `terraform/stacks/07-admin/main.tf`). Không có access key và không có quyền đọc dữ liệu trong S3 hay RDS.
- **Kubernetes:** ClusterRole chỉ `get`/`list` trên node, pod, event, PVC, namespace, workload và NodePool. Không đọc Secret.
- **Database:** phiên Postgres được đặt `default_transaction_read_only=on`. Tài khoản DB hiện là credential dùng chung
  với BFF (chưa có role DB chỉ-đọc riêng), nên tính chỉ-đọc dựa vào cài đặt phiên chứ chưa phải quyền của role.

## Chạy cục bộ

```bash
# 1. giao diện (cần mạng để tải font Geist lúc build)
cd web/admin/ui
npm ci && npm run build          # ra web/admin/ui/out

# 2. backend phục vụ bản export
cd ..
npm ci && npm run build
ADMIN_UI_DIR="$PWD/ui/out" \
ADMIN_USERNAME=admin \
ADMIN_PASSWORD_HASH="$(ADMIN_PASSWORD='mật-khẩu-thử-nghiệm' node dist/hash-password.js)" \
ADMIN_SESSION_SECRET="$(node -e "console.log(require('crypto').randomBytes(32).toString('hex'))")" \
SECURE_COOKIES=false PORT=5055 node dist/server.js
```

Ngoài cluster, các thẻ Kubernetes và AWS sẽ báo lỗi (không có ServiceAccount, không có credential). Đặt
`APP_DATABASE_URL` để xem phần dữ liệu sản phẩm. Test: `npm test` trong `web/admin` (backend) và `web/admin/ui` (giao diện).
Chỉnh giao diện nhanh: `npm run dev` trong `web/admin/ui` (cổng 3100) chỉ hiện form đăng nhập vì không có backend.

## Giới hạn hiện tại

- Chỉ đọc: chưa có thao tác dừng sandbox, khóa tài khoản hay chỉnh quota.
- Nhật ký thao tác của quản trị viên nằm trong bộ nhớ và log của pod (`kubectl -n admin logs`), mất khi pod restart.
- Không đọc được trạng thái Terraform (drift) từ trong pod.
- Chưa có số liệu CloudWatch.
- Lần tải đầu hiện tiếng Anh rồi đổi sang ngôn ngữ đã chọn, vì bản export tĩnh không đọc được cookie ngôn ngữ phía server.
