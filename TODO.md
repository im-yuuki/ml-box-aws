# ML Box — TODO checklist

Cập nhật: 2026-10-27

Ký hiệu:

- ✅ Đã hoàn thành hoặc đã xác nhận hoạt động.
- ☐ Chưa hoàn thành.
- ⚠️ Đã triển khai một phần nhưng còn blocker hoặc chưa đạt end-to-end.

## Hạ tầng và triển khai

- ✅ `00-bootstrap`: S3 Terraform state bucket và DynamoDB lock table.
- ✅ `01-foundation`: VPC, EKS, system node group, Karpenter và CPU NodePool.
- ✅ `02-platform`: RDS, workspace S3, Cognito, ECR, ALB, ACM và AWS Load Balancer Controller.
- ✅ Route53 authoritative cho `mlbox.june8th.me`; certificate notebook và apex đã `ISSUED`.
- ✅ `03-hub-app`: JupyterHub tại `notebook.mlbox.june8th.me` với CPU profile.
- ✅ Notebook theme light/dark adaptive và ML Box theme đã apply.
- ✅ `04-dashboard`: dashboard/BFF đã fresh deploy; pods Running và ALB target healthy.
- ✅ Sửa config production `DYNAMIC_SERVER_USAGE`: đã bỏ `cacheComponents`/`partialPrefetching` và xác nhận qua ALB (`/`, `/login` trả `200`).
- ✅ Build/push immutable dashboard+BFF images và apply lại toàn bộ luồng 00→04.
- ✅ Xác nhận ALB target dashboard healthy và `/`, `/login` trả `200` trong production.
- ✅ Remote state keys của `01`→`04` đã được tạo mới trong backend S3; không thực hiện state migration từ state cũ.
- ☐ Rà soát/migrate remote state keys sau khi đổi tên stack nếu có thay đổi naming tiếp theo.
- ✅ KMS key lịch sử không còn sử dụng đã được xác nhận ở `PendingDeletion`; không cancel deletion.
- ☐ Hoàn thiện CI/CD build, scan, push image và rollout có approval.

## Dashboard UI

- ✅ Next.js App Router + TypeScript + HeroUI v3 scaffold.
- ✅ Landing page, login, register, sandboxes, usage và account pages.
- ✅ Responsive light/dark theme theo system preference và local override.
- ✅ i18n English/Vietnamese bằng `next-intl` và cookie `mlbox-locale`.
- ✅ Locale switcher và `/api/locale` route.
- ✅ Dockerfile multi-stage và build args Cognito/BFF.
- ✅ Production runtime healthy qua ALB; dashboard pod và target đều healthy, `/` và `/login` trả `200`.
- ☐ Hoàn thiện `/verify` email confirmation page.
- ☐ Hoàn thiện `/sandboxes/new` flow.
- ☐ Thay mock data bằng API thật trên toàn bộ dashboard.

## Authentication và BFF

- ✅ Cognito user pool và public dashboard app client đã được fresh apply trong `02-platform`.
- ✅ Dashboard có config/client scaffolding; auth UI đã gọi same-origin BFF.
- ✅ Source `web/bff/` (Fastify/TypeScript), Dockerfile và lockfile đã có.
- ✅ BFF verify Cognito JWT bằng JWKS, issuer, client và claims; session dùng encrypted HttpOnly cookie.
- ✅ Hub service token được random trong `03-hub-app`, xuất sensitive và inject vào Kubernetes Secret.
- ✅ BFF map Cognito email sang Hub username và proxy list/start/stop Hub REST API.
- ✅ Các `/api/bff/*` route proxy không còn trả `501 BFF_NOT_DEPLOYED`.
- ✅ Terraform đã có BFF Deployment/Service/Secret và nối dashboard qua `BFF_INTERNAL_URL`.
- ⚠️ Hạ tầng đã apply; BFF health/readiness đã xác nhận, còn test Cognito thật cần test user.
- ☐ Bổ sung refresh-token/session rotation, CSRF protection, forgot-password và revoke/logout hardening.

## Sandbox lifecycle

- ✅ UI danh sách sandbox đã nối API BFF và có loading/error/empty state.
- ✅ BFF list server thật theo user và giới hạn username từ session đã verify.
- ⚠️ Đã redeploy; test sandbox list với Cognito/JupyterHub user thật cần test user.
- ☐ Spawn sandbox mới từ `/sandboxes/new`.
- ✅ Stop/start sandbox hiện có qua BFF và hiển thị trạng thái pending.
- ☐ Link vào Lab thật qua `notebook.mlbox.june8th.me` sau khi SSO/session mapping được xác nhận.
- ☐ Xử lý timeout, quota exceeded, failed server và retry đầy đủ.
- ☐ Thêm authorization test: user A không thấy hoặc điều khiển sandbox của user B.

## Usage và quota

- ✅ Có UI quota cards cho CPU, RAM, storage và GPU-hours dạng mock.
- ☐ Định nghĩa nguồn dữ liệu và semantics quota theo user/period.
- ☐ BFF cung cấp usage/quota API từ Hub và nguồn dữ liệu đã duyệt.
- ☐ Persist usage/quota thay vì dữ liệu hard-coded.
- ☐ Implement CPU/RAM/storage limits và thông báo khi gần/vượt quota.
- ☐ GPU-hours accounting; chỉ làm sau khi GPU stack và policy quota được chốt.
- ☐ Hiển thị timezone, kỳ quota, last updated và trạng thái dữ liệu.

## GPU

- ✅ GPU Terraform đã được tách thành `99-unverified-gpu` để không nằm trong luồng bắt buộc.
- ✅ GPU profiles trong `03-hub-app` hiện tắt (`enable_gpu_profiles=false`).
- ☐ Xin và xác nhận EC2 GPU quota trong region mục tiêu.
- ☐ Validate GPU image, NVIDIA device plugin, time-slicing và DCGM exporter.
- ☐ Apply `99-unverified-gpu` sau khi có quota và backup state.
- ☐ Bật GPU profile trong `03-hub-app` rồi kiểm tra scheduling/device visibility.
- ☐ Test dedicated/shared GPU sandbox và giới hạn GPU-hours.

## Security, reliability và vận hành

- ✅ Có deployment runbook tại `docs/DEPLOYMENT.md`.
- ✅ Có operations runbook tại `docs/OPERATIONS.md`.
- ☐ Hoàn thiện secret management cho Hub/BFF bằng Kubernetes Secret/Secrets Manager.
- ☐ Review IAM least privilege cho Terraform, LB controller, Karpenter, Hub và BFF.
- ☐ Bổ sung monitoring/alerting cho EKS, ALB, target health, pod restart, RDS và quota.
- ☐ Bổ sung log retention, audit trail và hướng dẫn điều tra incident.
- ☐ Bổ sung backup/restore test cho RDS, S3 workspace và Terraform state.
- ☐ Tạo budget/cost anomaly alert và quy trình dừng lab khi không sử dụng.
- ☐ NetworkPolicy và egress policy cho namespace dashboard/BFF.
- ☐ Security scan dependency/container và image signing/provenance.
- ☐ Define SLO/health endpoint và readiness/liveness checks cho dashboard/BFF.

## Tài liệu và quản trị thay đổi

- ✅ Stack names/order đã chuẩn hóa: `00`, `01`, `02`, `03`, `04`, optional `99`.
- ✅ README, DNS deployment guide và architecture diagram đã cập nhật theo stack mới.
- ✅ Commit history đã rewrite về `Yuuki <me@june8th.eu.org>` và force-push.
- ☐ Khi migrate state key, ghi lại mapping, backup và kết quả verify trong change record.
- ☐ Cập nhật tài liệu sau mỗi lần thay đổi public URL, stack output, image tag hoặc auth flow.
- ☐ Viết acceptance checklist cho release dashboard và BFF trước khi tuyên bố production-ready.
