# ML Box — TODO checklist

Cập nhật: 2026-10-29

Target WebUI multi-tenant và trình tự triển khai được mô tả tại
[`docs/multi-tenant-product-plan.md`](docs/multi-tenant-product-plan.md). Các mục
trong kế hoạch đó chưa được coi là hoàn thành chỉ vì đã được thiết kế.

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
- ✅ Hoàn thiện `/sandboxes/new` flow.
- ⚠️ Usage/quota realtime đã nối API thật; các màn hình khác vẫn còn phần mock cần thay dần.

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
- ✅ Spawn sandbox mới từ `/sandboxes/new`.
- ✅ Stop/start sandbox hiện có qua BFF và hiển thị trạng thái pending.
- ☐ Link vào Lab thật qua `notebook.mlbox.june8th.me` sau khi SSO/session mapping được xác nhận.
- ☐ Xử lý timeout, quota exceeded, failed server và retry đầy đủ.
- ☐ Thêm authorization test: user A không thấy hoặc điều khiển sandbox của user B.

## Usage và quota

- ✅ Usage page hiển thị quota policy `32 CPU-hours / 24 GB RAM / 20 GB storage / 0 GPU-hours`.
- ✅ BFF `GET /v1/usage` lấy server/state/last_activity từ JupyterHub và trả timestamp realtime.
- ✅ Realtime footprint tách khỏi historical usage; CPU-hours và storage usage trả `null` khi chưa tracking.
- ✅ RAM footprint chỉ hiển thị khi Hub trả resource metadata; thiếu metadata không đoán giá trị.
- ✅ Dashboard có loading, error, unauthenticated, empty và unavailable states; có English/Vietnamese translations.
- ☐ Persist historical usage/quota thay vì chỉ đọc footprint realtime.
- ☐ Implement CPU/RAM/storage enforcement và thông báo khi gần/vượt quota.
- ☐ GPU-hours accounting; chỉ làm sau khi GPU stack và policy quota được chốt.
- ✅ Hiển thị timestamp cập nhật và trạng thái tracking của từng metric.

## GPU

- ✅ GPU Terraform đã được tách thành `99-unverified-gpu` để không nằm trong luồng bắt buộc.
- ✅ GPU profiles trong `03-hub-app` hiện tắt (`enable_gpu_profiles=false`).
- ☐ Xin và xác nhận EC2 GPU quota trong region mục tiêu.
- ☐ Validate GPU image, NVIDIA device plugin, time-slicing và DCGM exporter.
- ☐ Apply `99-unverified-gpu` sau khi có quota và backup state.
- ☐ Bật GPU profile trong `03-hub-app` rồi kiểm tra scheduling/device visibility.
- ☐ Test dedicated/shared GPU sandbox và giới hạn GPU-hours.

## Hub Provisioning Adapter

### Phase 1 — Provisioning trong BFF (đã triển khai local, chờ deploy)

- ✅ Thêm `ensureHubUser` idempotent qua JupyterHub REST API, username chỉ lấy từ authenticated session.
- ✅ Eager provision khi load `/sandboxes`; lazy provision + retry start tối đa một lần.
- ✅ Giữ authorization app-owned trước khi provision; không tạo Hub user cho request trái quyền.
- ✅ Bổ sung service role scopes tối thiểu `admin:users`, `servers`, `admin:servers`.
- ✅ Giữ Hub activation card làm fallback cho lỗi quyền/token/mapping/Hub.
- ✅ Test existing/new user, race/idempotency, retry-once, provisioning failure và secret containment.
- ☐ Apply stack `03-hub-app`, deploy BFF image và verify production E2E sau khi AWS credentials hợp lệ.

### Phase 2 — Sandbox lifecycle (đã triển khai local, chờ deploy/production verification)

- ✅ Phân biệt canonical states `starting`, `ready`, `stopped`, `failed` ở BFF và dashboard.
- ✅ Giữ status/body Hub 201/202 trong BFF; polling progress có timeout và backoff giới hạn.
- ✅ Retry transient có giới hạn, không duplicate spawn; lifecycle audit best-effort cho request/starting/retry/ready/failed/stopped.
- ✅ Dashboard refresh có giới hạn khi sandbox đang `starting`; Hub activation fallback vẫn được giữ.
- ☐ Apply/deploy thay đổi và verify production E2E sau khi có Terraform plan hợp lệ, backup và AWS credentials.

### Phase 3 — Stable identity mapping (đã triển khai local, compatibility mode)

- ✅ Resolve identity mới từ Cognito `sub` thành `cognito-${sub}`; stored legacy mapping và owner-scoped legacy sandbox mapping được ưu tiên.
- ✅ Email rename giữ nguyên Hub username; email chỉ là metadata/display; collision không overwrite và không provision.
- ✅ Có additive `mlbox_hub_identities`, dry-run planner, conflict handling và rollback helper; sandbox ownership/Hub users không bị rename hoặc xóa.
- ✅ Giữ JupyterHub OAuth `username_claim: email`; rollout hiện là BFF compatibility mode, chưa migrate Hub records production.
- ✅ Có read-only migration dry-run command (`cd web/bff && npm run identity:dry-run`) trả report và chặn apply khi có collision.
- ☐ Backup database, review report/collisions, chuẩn bị rollback, rồi mới plan/apply production migration.
- ☐ Chạy integration/E2E verification sau migration; không bật mapping production trước khi các safeguard được hoàn tất.

### Phase 4 — Optional JupyterHub extension (chỉ khi cần)

- ☐ Đánh giá REST/service role sau Phase 1–2 cho profile, entitlement/quota, metadata và lifecycle events.
- ☐ Chỉ xây extension/service hook nếu REST không đáp ứng; không fork JupyterHub core.
- ☐ Chỉ đánh giá orchestrator thay thế khi chứng minh JupyterHub là giới hạn thực tế.

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

## Product control plane: Space → Team → Project

Target model: Personal/Organization là loại của Space; mỗi Space có Team phẳng; mỗi
Project thuộc đúng một Team; Sandbox tạm thời 1:1 với Project; Artifacts tồn tại độc
lập runtime. Không nested Team, không cross-Space project sharing, không shared
multi-user Sandbox. Xem [`docs/multi-tenant-product-plan.md`](docs/multi-tenant-product-plan.md)
để biết schema logic, quyền, UX, branding, migration và acceptance criteria đầy đủ.

### Phase 1 — Foundation và authorization

- ☐ Chốt app-owned relational schema/migration framework; đánh giá mở rộng dashboard usage PostgreSQL hay tạo app DB riêng; tuyệt đối không dùng Hub-owned schema.
- ☐ Chuyển application user key sang Cognito `sub`; bootstrap Personal Space + default Team cho user hiện tại/mới.
- ☐ Implement Space membership, invitation lifecycle và role cố định Owner/Admin/Member/Viewer.
- ☐ Implement flat Team CRUD/membership/Lead; bảo đảm Team và Project luôn cùng Space.
- ☐ Implement server-side permission resolution, Project direct overrides (Manager/Contributor/Viewer/Blocked), Owner/Admin bypass và permission cache invalidation.
- ☐ Thêm audit events cho invite, membership/role/team/project access, billing mock và thay đổi runtime.
- ☐ Viết authz tests: default deny, isolation giữa Space, Team inheritance, direct override/Blocked, Viewer cap, revocation và Owner/Admin không bị khóa.

### Phase 2 — Project-first và runtime

- ☐ Tạo Project CRUD/API/UI; mọi Project thuộc đúng một Team; thêm project search theo Space hiện tại.
- ☐ Migration idempotent: ánh xạ named Hub sandbox hiện hữu vào Project mặc định trong Personal Space/Team; giữ nguyên server/dữ liệu và có backup/rollback.
- ☐ Thêm Space switcher, Teams/Members admin, project detail/settings; giữ `/sandboxes` và API cũ làm compatibility alias trong migration.
- ☐ Chuyển BFF sandbox actions sang authorize theo Project rồi resolve server từ Project record; không nhận Hub username tùy ý.
- ☐ Giữ một Sandbox/Project, user-owned Hub runtime và single active user; thêm start/stop/change profile cùng pending/failure/quota states.
- ☐ Test project-level permission trước mọi Hub list/start/stop, kể cả sửa Space/Project ID từ client.

### Phase 3 — Persistent artifacts và tenant isolation

- ☐ Thêm Artifact metadata và upload/download API gắn Project.
- ☐ Chuyển object key sang `spaces/{space_id}/projects/{project_id}/...`; BFF authorize trước khi cấp presigned URL.
- ☐ Rà IAM/bucket policy/session scope thực tế; chứng minh runtime/browser không thể đọc prefix ngoài Project được cấp.
- ☐ Viết migration/backup/restore và integration tests cho S3 isolation; dừng/xóa Sandbox không xóa Artifacts.

### Phase 4 — Subscription, usage và Turnstile

- ☐ Tạo subscription/entitlement theo Space; mock plan activation cập nhật trạng thái ngay và ghi audit, không tích hợp payment provider.
- ☐ Thiết kế usage ledger theo Space/Project/Sandbox/User/resource; xác minh nguồn dữ liệu trước khi enforce hoặc hiển thị billing chính xác.
- ☐ Thêm Turnstile config bật/tắt riêng cho registration và mock checkout; mặc định tắt local/dev.
- ☐ Khi bật registration protection, hiển thị widget ở `/register`; gửi token qua BFF và verify server-side trước Cognito SignUp.
- ☐ Khi bật checkout protection, verify server-side trước khi activate mock subscription; secret chỉ ở BFF, không log token.
- ☐ Test Turnstile disabled/enabled, token thiếu/sai/hết hạn/replay và Siteverify unavailable; bật mà verify lỗi phải fail closed.

### Phase 5 — Brand pack và release readiness

- ☐ Chốt logo concept open-box M/B, kiểm tra contrast/light-dark và tạo wordmark, symbol, compact mark, favicon/app icon, monochrome/reversed SVG.
- ☐ Áp dụng token dùng chung cho Dashboard, Hub và Lab; giữ `web/theme/tokens/heroui-tokens.css` là nguồn sự thật.
- ☐ Hoàn thiện project-first navigation: logo + Space switcher, project search, preferences (theme/language), avatar menu (Usage/Account/billing theo quyền).
- ☐ Hoàn tất en/vi, responsive, keyboard/focus, loading/empty/error/unauthorized states và E2E với ít nhất hai Space.
- ☐ Viết release, data migration, backup/restore, rollback và operations checklist; chỉ đánh dấu hoàn tất sau khi kiểm chứng.
