# MLBox — Backlog

Cập nhật: 2026-11-13

Ký hiệu: ✅ xong và đã kiểm chứng · ⚠️ đã làm nhưng còn thiếu kiểm chứng hoặc còn phụ thuộc · ☐ chưa làm

Target sản phẩm và thứ tự phase: [`docs/multi-tenant-product-plan.md`](docs/multi-tenant-product-plan.md). Vận hành: [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md), [`docs/OPERATIONS.md`](docs/OPERATIONS.md).

## Trạng thái hiện tại

- **Hạ tầng (region `ap-southeast-2`, account `451058046864`):**
  - Ngày 2026-11-13 đã **phá toàn bộ stack `01`–`07` và dựng lại từ đầu**, giữ `00-bootstrap` (zone Route53, chứng thư ACM, bucket state, bảng lock). Mục tiêu: kiểm chứng khả năng reproducible và làm rõ dữ liệu database cũ.
  - Thứ tự apply đúng đã được xác nhận: `00` → `01` → `02` → **`06`** → `03` → theme → `04` → `05` → `07`. `06-storage` phải trước `03-hub-app` vì Hub tạo PVC với StorageClass `efs-sc`.
  - `02-platform` giờ tạo namespace `dashboard` (nó quản lý Role/RoleBinding của GitHub deployer trong namespace đó) — trước đây apply trên account mới sẽ lỗi vì namespace chỉ tồn tại sau `04-dashboard`.
  - `02-platform` có 2 biến mới: `dashboard_usage_deletion_protection` và `dashboard_usage_final_snapshot_identifier` để destroy được ở lab mà vẫn an toàn ở prod.
  - `07-admin` không còn hard-code account trong `state_bucket`; biến này bắt buộc phải truyền vào.
  - **Khắc phục khi redeploy:** Karpenter node role thiếu `ecr:GetAuthorizationToken` (đã thêm IAM policy `<cluster>-karpenter-node-ecr` vào `terraform/modules/karpenter/node-role.tf`); stack `05-gpu` cần namespace `gpu-operator-resources` trước khi apply ConfigMap (đã thêm vào `terraform/modules/gpu-stack`); chờ cert ACM dùng `aws acm wait certificate-validated` (đa nền tảng); AL2023 AMI `al2023@latest` không khởi động nodeadm lúc boot trên node Karpenter — đã fix bằng `userData` trong cả hai EC2NodeClass, node mới tự Ready (đã kiểm: node mới tạo tự Ready và node cũ bị drift/terminate).
  - Đã kiểm chứng: 3 node Ready, Hub/Dashboard/BFF/admin-console Running, cả 3 ALB target group `healthy`, các URL chính trả 200/302 (notebook, dashboard, admin) — kiểm thêm bằng trình duyệt: `/`, `/login`, `/register`, `/quota`, `/teams`, `/account`, `/projects`, `/forgot-password`, `admin.june8th.me` (TLS + form đăng nhập) đều render, không 404. Xem chi tiết trong `docs/DEPLOYMENT.md` mục 19.
- **Image đang chạy:**
  - Cả 5 image: `ghcr.io/im-yuuki/mlbox-{dashboard,bff,admin,cpu,gpu}:61c5083681579b41140fa98abbeed3d0d1155e9c` (commit merge PR #13 trên `master`). Image `mlbox-admin` mới chỉ có tag này.
  - ECR đã bị xóa. Không còn image nào trên ECR.
- **Database:** hai RDS đã được tạo lại từ đầu, dữ liệu cũ không còn. Schema ứng dụng được BFF tạo lần đầu khi có request xác thực (`ensureSchema()`), không phải lúc khởi động; DB hiện không có bảng/dòng nào.
- **Hub:** `enable_auth_state=false`. Notebook lưu home trên EFS, một PVC cho mỗi Project.
- **Git:** `master` = `61c5083` (merge PR #13, admin dashboard operations).
- **Test:** BFF `npm test` 133/133. Test tích hợp Postgres: 14/14 theo lần chạy tay ngày 2026-11-05 (chưa chạy lại sau các thay đổi billing; chưa vào CI). Dashboard `tsc --noEmit` còn 2 lỗi có sẵn (`PageProps`, `LayoutProps`).

## Cần người dùng quyết định

- ☐ **GPU dedicated (`d1.xlarge`) và shared (`g1.xlarge`) cùng giá 10 units/giờ và cùng điều kiện gói.** Đã giữ nguyên theo yêu cầu. Có gate riêng cho dedicated (ví dụ chỉ gói Pro) hay không là quyết định còn mở.
- ☐ **Số units và giá gói là giả định demo** (Free 20 units, Plus 100, Pro 300; $0/$8/$19). Chưa công bố; mock không thu tiền. Cần chốt trước khi công bố cho người dùng.
- ☐ **Logo và brand pack (phase 8):** người dùng chọn concept logo.
- ☐ **Nhánh `claude/update-backlog-2026-11-10`** (file này) chưa push. Cần xác nhận để mở PR.
- ✅ **AL2023 AMI (`al2023@latest`) không khởi động nodeadm lúc boot trên node Karpenter**: đã fix bằng `userData` trong cả hai EC2NodeClass (`terraform/modules/karpenter/manifests/ec2nodeclass-*.yaml`); node mới tự Ready sau ~90s, node cũ bị drift/terminate tự động, không cần động tác thủ công.
- ☐ **Commit/push các thay đổi của lần rebuild 2026-11-13** (xem `git status`). Theo quy ước, agent không tự commit.

## Đã xong (đã kiểm chứng ở mức code/deploy)

### Hạ tầng và deploy
- ✅ Hạ tầng 00–07 và Route53/ACM cho `mlbox.june8th.me`, `notebook.mlbox.june8th.me`; ngày 2026-11-13 đã phá và dựng lại toàn bộ để kiểm chứng reproducible.
- ✅ `00-bootstrap` sinh `backend.hcl` cho cả `06-storage` và `07-admin` (trước đó thiếu, phải tự tạo tay).
- ✅ **Reproducibility fixes tìm và sửa trong lần rebuild 2026-11-13:** IAM policy `<cluster>-karpenter-node-ecr` (Karpenter node role thiếu `ecr:GetAuthorizationToken` → node không bao giờ Ready), namespace `gpu-operator-resources` trong `terraform/modules/gpu-stack` (apply ConfigMap trước namespace), `02-platform` giờ tạo namespace `dashboard` (Role của GitHub deployer), chờ cert ACM dùng `aws acm wait certificate-validated` (đa nền tảng), 2 biến biến `dashboard_usage_deletion_protection` / `..._final_snapshot_identifier`.
- ✅ Rollout pin image theo commit SHA `61c5083` (master mới nhất); image `mlbox-admin` lần đầu được deploy lên cluster thật.
- ✅ Image publish tự động lên GHCR theo commit SHA (`.github/workflows/images.yml`, PR #7). Cache npm/pip cho job theme-wheel.
- ✅ Chuyển khỏi ECR: module, repo, publisher role và policy đã xóa (2026-11-10). Hai image cuối cùng xóa tay vì repo còn image và không pod nào dùng.
- ✅ Rollout lần đầu sau PR #9 (2026-11-10): dashboard và BFF healthy, `mlbox.june8th.me` trả 200, Hub `hub/api` trả 200.
- ✅ Hub notebook storage: một EFS-backed PVC cho mỗi Project (`stacks/06-storage`, values Hub `dynamic`). Trước đây mất file khi stop.
- ✅ BFF xóa PVC của Project khi xóa Project (RBAC trong namespace `hub`).

### Hub và đăng nhập
- ✅ Auth Cognito qua BFF: register, confirm, login, logout, refresh, forgot/reset, change password; CSRF; session cookie.
- ✅ Turnstile cho register và checkout, bật theo cấu hình.
- ✅ Hub spawn không cần auth state (BFF làm việc spawn).
- ✅ Mở notebook qua mã handoff một lần (60 giây, chỉ lưu hash, dùng được một lần). Người dùng không vào UI Hub. Hub dùng `MlBoxBffAuthenticator`, BFF là cổng kiểm soát (`allow_all`).
- ✅ Đăng xuất dashboard cũng kết thúc phiên Hub (`/hub/logout`, commit 7e517f9).
- ✅ Trạng thái sandbox đọc từ `GET /users/<u>`, vì JupyterHub 5 trả 405 với GET named server; `state` có thể là object.
- ✅ Usage CPU và RAM cấp phát đọc từ pod spec (BFF có Role đọc pod trong `hub`). Đã kiểm: sandbox 2 cores, 4 GB.

### Dashboard và tổ chức
- ✅ Shell mới: top bar, Projects-first navigation, Space switcher, palette ấm (PR #6, #8). Mock API để chạy dashboard local.
- ✅ Điều hướng: Projects, Teams, Usage, Account; `/sandboxes` chuyển về `/projects`.
- ✅ Personal Space và default Team cho mỗi user.
- ✅ Project: list/create theo Space, phân quyền theo team và direct grant (blocked, manager, contributor, viewer).
- ✅ Team phẳng: tạo, liệt kê, thêm/xóa thành viên, chặn xóa lead cuối cùng.
- ✅ Lời mời Space: owner/admin mời, thu hồi; người được mời chấp nhận đúng email (không gửi email).
- ✅ Xóa Project (soft): giữ lịch sử usage, giải phóng tên, xóa file. Có xác nhận.
- ✅ Account: hồ sơ (họ tên, chức danh, múi giờ, avatar), đổi email có xác minh Cognito, danh sách phiên đăng nhập và đăng xuất từng phiên hoặc tất cả trừ phiên hiện tại.
- ✅ Thiết kế runtime: hiển thị loại instance (c1/g1/d1), copy ID, chọn profile khi sandbox dừng.

### Sandbox, artifact, usage
- ✅ Sandbox theo Project: đọc, start, stop; runtime chạy dưới Hub user của owner Project. Start nhận profile (`cpu-small`, `cpu-medium`, `cpu-large`, GPU khi bật).
- ✅ Kiểm tra RAM quota khi start theo RAM của profile đã chọn (commit 5babfd4).
- ✅ Artifact (MVP): metadata Postgres; upload/download qua presigned URL; key dưới `spaces/{space}/projects/{project}/`.
- ✅ Artifact: bật/tắt lưu trữ theo Project (có xác nhận trước khi xóa file), retention theo gói (7/14/30 ngày), thanh dung lượng.
- ✅ Cách ly workspace: role workspace của hub chỉ `users/*`, deny `spaces/*`; role BFF chỉ `spaces/*`.
- ✅ Usage (MVP): phiên sandbox từ sự kiện start/stop/observed; tổng giờ theo Project và Space.

### Billing (mock)
- ✅ Mô hình compute-unit: một pool units/tháng cho mỗi Space; CPU 1 unit/giờ, GPU 10 unit/giờ (`COMPUTE_UNIT_RATES`).
- ✅ Gói: Free (20 units, CPU only), Plus (100, GPU), Pro (300, GPU), Org Team và Growth. Đã xoá các gói "sắp ra mắt" (Personal Power, Organization Scale, Organization Enterprise) khỏi catalog.
- ✅ Start sandbox bị chặn khi gói không có GPU (`403 GPU_NOT_IN_PLAN`) hoặc hết units (`429 QUOTA_EXCEEDED`, `metric: compute_units`).
- ✅ Session lưu `units_per_hour` lúc start (migration `ADD COLUMN`, mặc định 1 cho dòng cũ). Session mở quá 24 giờ bị đóng ở mốc 24 giờ.
- ✅ `/v1/usage` trả pool units của personal Space; panel Usage hiển thị units thay cho meter CPU/GPU giờ (không đo được).
- ✅ Profile list đánh dấu `available: false` cho profile gói không cho phép.
- ✅ Pricing doc và `COMPUTE_UNIT_RATES` đã cập nhật.

### GPU
- ✅ **NodePool shared chuyển sang g4dn.xlarge (T4) only** (2026-11-07). g6.xlarge (L4) thiếu capacity ở cả 3 AZ Sydney. Time-slicing 2 replica @ 8GB commit. Đã chạy `nvidia-smi` và pod `gpu-smoke`, allocatable `nvidia.com/gpu: 2`.
- ✅ Đổi tên stack `99-unverified-gpu` → `05-gpu` sau lần apply đầu (2026-11-07).

## Đang triển khai / cần kiểm chứng

- ⚠️ **Admin console (`web/admin`, stack `07-admin`):** backend 21 test, giao diện 8 test, `terraform validate` đạt, đăng nhập và khóa thử sai kiểm qua HTTP cục bộ, giao diện (HeroUI, token chung với dashboard, en/vi, sáng/tối) kiểm trên trình duyệt với dữ liệu mô phỏng. Image đã publish (`mlbox-admin`), stack đã apply lần đầu ngày 2026-11-13 trên cluster thật; các khối Kubernetes/AWS/Postgres đã chạy với dữ liệu thật. Đã kiểm qua trình duyệt: `admin.mlbox.june8th.me` TLS hợp lệ, `/healthz` 200, `/api/session` đúng, form đăng nhập render đúng (chưa đăng nhập bằng tài khoản thật). Đã có thêm Capacity, Storage, Billing và bốn thao tác hỗ trợ có audit lưu bền (tắt mặc định, `enable_actions`); mọi truy vấn SQL và thao tác đã chạy trên PostgreSQL thật (23 test tích hợp). Còn thiếu: role DB riêng cho console, CloudWatch, xóa volume mồ côi.

- ⚠️ **Notebook storage EFS (rebuild 2026-11-13):** EFS mới hoàn toàn, chưa kiểm tra spawn thật → mount → ghi file → stop → start → đọc lại file. Chưa kiểm tra xóa Project xóa PVC và access point.
- ⚠️ **Billing metering:** chưa kiểm chứng trên Postgres thật. Cần kiểm tra mở/đóng session, cap 24 giờ, tổng units trong tháng, và gate `403/429` khi start.
- ✅ **E2E đăng ký/đăng nhập/sandbox qua trình duyệt (2026-11-13, tài khoản thật qua mail.tm, đã xóa sau test):** register → confirm (mã từ mail.tm) → login → tạo Project → start sandbox c1.large → mở notebook qua handoff (JupyterLab render) → trang `/quota` hiển thị quota và usage thật → stop sandbox → xóa Project. DB reset cho lần test (xóa user/project trong `usage_history` và hub `jhub`).
- ⚠️ **E2E trình duyệt còn thiếu:** nút đăng xuất trên UI (cần đăng nhập lại); lời mời được chấp nhận bởi người khác (cần tài khoản thứ hai); đổi email và đổi avatar; thu hồi phiên đăng nhập có hiệu lực với access token còn hạn.
- ⚠️ **Redesign giao diện:** shell đã xong. Còn màn Projects/Project/Teams/Usage/Account, auth và Hub. Cần chụp trước/sau ở mobile, tablet, desktop; sáng/tối; en/vi; kiểm tra a11y.
- ⚠️ **Hiển thị lỗi gói:** `planRequired` đã map trong hook và có chuỗi en/vi. Chưa kiểm tra namespace i18n khi chạy UI.
- ⚠️ **Hook VRAM balloon** trên pod thật với T4 (đã test trên g4dn nhưng chưa test với profile GPU từ dashboard).

## GPU (còn lại)

- ☐ Bật `serviceMonitor` của dcgm-exporter khi cluster có Prometheus CRD; kiểm tra metric thật.
- ✅ **State `01-foundation` lệch cluster:** đã xử lý bằng cách destroy + rebuild toàn bộ; state mới khớp cluster (label `nvidia.com/device-plugin.config=any` nay được khai báo trong Terraform, không còn patch tay).
- ☐ Cập nhật tài liệu thiết kế GPU: `renameByDefault=false` là quyết định mới (xem `terraform/modules/gpu-stack`).

## Dashboard và BFF (còn thiếu)

- ☐ Tạo organization Space self-serve (hiện tạo bằng SQL).
- ☐ Gửi email lời mời (hiện chỉ ghi nhận trong hệ thống).
- ☐ UI quản lý quyền Project (manager/contributor/viewer/blocked) và thu hồi quyền có hiệu lực ngay.
- ☐ Đổi tên Project và Project settings (xóa đã xong).
- ☐ Đổi profile khi runtime đang chạy (hiện chỉ khi đã dừng; đổi profile cần stop/restart).
- ☐ Xóa artifact đơn lẻ; phân trang danh sách artifact và Project.
- ☐ Enforce hạn mức storage (retention và thanh dung lượng đã có; chưa chặn upload khi vượt).
- ☐ Thanh toán thật: không trong phạm vi hiện tại.
- ☐ Turnstile: test đầy đủ disabled/enabled/token sai/hết hạn/replay/Siteverify lỗi.
- ☐ Form `/verify` và các màn hình còn mock; kiểm tra responsive, en/vi cho các màn mới.
- ☐ Lỗi typecheck có sẵn trong `web/dashboard`: `PageProps` (`src/app/(app)/projects/[projectId]/page.tsx`) và `LayoutProps` (`src/app/layout.tsx`). Có thể do generated types chưa có. Sửa hoặc xác nhận build pass.
- ✅ Đã xoay secret lộ trong output plan: client Cognito `jupyterhub` (thay mới), `HUB_AUTH_BRIDGE_TOKEN`, `BFF_SESSION_SECRET` (mọi phiên cũ mất hiệu lực).

## Billing (còn lại)

- ☐ Kiểm chứng metering trên Postgres thật (xem mục đang triển khai).
- ☐ Quyết định GPU dedicated có gate riêng không (xem mục cần quyết định).
- ☐ Kiểm tra migration `units_per_hour` trên dữ liệu usage cũ. Dòng cũ đang tính theo rate 1 (CPU).
- ☐ Không có nguồn billing chính xác: mọi số liệu là usage từ sự kiện BFF, không phải dữ liệu thanh toán.

## Cách ly và bảo mật

- ☐ **EFS single-AZ:** mount đang ghim vào một mount target qua `mounttargetip` (IPv4), vì DNS64 trả về địa chỉ NAT64 làm NFS treo. Cần mount target IPv6 hoặc tắt DNS64 trên private subnet để bỏ phụ thuộc một AZ.
- ☐ Kiểm tra cross-tenant trên cluster thật với hai danh tính thật (`web/bff/test/authz-matrix.md`), gồm cả access point EFS của từng Project.
- ☐ Runtime user (notebook) chưa có sidecar đồng bộ `users/<id>/`. Khi thêm, phải dùng session policy riêng cho từng user (không dùng role workspace trực tiếp).
- ☐ Review IAM least privilege: Terraform, LB controller, Karpenter, hub, BFF.
- ☐ Secret management: chuyển secret Hub/BFF sang Kubernetes Secret có kiểm soát hoặc Secrets Manager.
- ☐ NetworkPolicy và egress policy cho namespace dashboard/BFF.
- ☐ Scan dependency/container; ký image và provenance.

## Test và CI

- ✅ BFF unit test (`npm test`, 133 test). Test tích hợp Postgres (`npm run test:integration`, cần `DATABASE_URL`).
- ✅ Build và push image GHCR tự động.
- ☐ Đưa test tích hợp Postgres vào CI (hiện chạy tay).
- ☐ Test dashboard cho component và route (hiện chỉ có test helper).
- ☐ CD: `deploy.yml.disabled` vẫn tắt. Rollout hiện thủ công theo `docs/DEPLOYMENT.md`; cần rollout có approval.

## Vận hành

- ✅ **Image cho `cpu_image`/`gpu_image` của `03-hub-app` trỏ sang ECR:** đã cập nhật `terraform.tfvars` sang GHCR SHA `61c5083...` (trước đó nó trỏ ECR đã xóa).
- ☐ **Backup notebook storage:** EFS hiện giữ file người dùng nhưng chưa có backup/restore được kiểm chứng.
- ✅ Runbook rollout: `docs/DEPLOYMENT.md` và `docs/OPERATIONS.md` đã mô tả pin tag SHA, thứ tự apply và cách rollback bằng tag cũ (chưa kiểm tra E2E).
- ☐ Monitoring/alert cho EKS, ALB, target health, pod restart, RDS, quota GPU.
- ☐ Log retention, audit trail và hướng dẫn điều tra incident.
- ☐ Backup/restore test cho RDS, S3 workspace và Terraform state.
- ☐ Budget và cost anomaly alert; quy trình dừng lab khi không dùng.
- ☐ Runbook và rollback cho các tính năng mới (team, lời mời, sandbox theo Project, artifact, usage, billing units).
- ☐ Acceptance checklist cho release dashboard và BFF trước khi tuyên bố production-ready.

## Phase còn lại của kế hoạch multi-tenant

- ⚠️ Phase 6 (subscription và usage): mock subscription và pool units có; metering chưa kiểm chứng trên DB thật; không có thanh toán thật.
- ⚠️ Phase 7: Turnstile theo luồng đã có; test đầy đủ còn thiếu (xem mục Dashboard).
- ⚠️ Phase 8: Space switcher và shell đã có; logo, brand pack và token dùng chung còn thiếu.
- ☐ Phase 9: release hardening, migration/backup/restore, runbook, rollback.

## Tài liệu

- ✅ Đã xóa các tài liệu đã hoàn thành hoặc đã bị thay thế. Lịch sử vẫn có trong git.
- ☐ Cập nhật tài liệu sau mỗi thay đổi public URL, stack output, image tag hoặc auth flow.
- ✅ `docs/DEPLOYMENT.md` đã viết lại toàn bộ: 8 stack, thứ tự apply, khoảng nghỉ DNS/ACM, GHCR, reset database, teardown, checklist "triển khai trên account của bạn" (đã kiểm chứng bằng lần rebuild 2026-11-13).
- ☐ State local của `00-bootstrap` đã mất (chỉ còn state của 01–05/06 trên S3). Không `plan`/`destroy` được `00-bootstrap` nếu chưa `terraform import` lại resource của nó; cần export backup state này cho mọi account.
- ☐ Chưa có tự động hoá: `terraform destroy` toàn bộ stack theo thứ tự phụ thuộc, và bước `aws s3 rb --force` cho bucket workspace (versioning).
- ✅ `docs/OPERATIONS.md` đã cập nhật: đăng nhập SSO (`aws login`), thứ tự destroy mới, admin console, local-state warning.
