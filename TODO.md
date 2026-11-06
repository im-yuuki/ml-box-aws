# MLBox — Backlog

Cập nhật: 2026-11-05

Ký hiệu: ✅ xong và đã kiểm chứng · ⚠️ đã làm nhưng còn thiếu kiểm chứng hoặc còn phụ thuộc · ☐ chưa làm

Target sản phẩm và thứ tự phase: [`docs/multi-tenant-product-plan.md`](docs/multi-tenant-product-plan.md). Vận hành: [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md), [`docs/OPERATIONS.md`](docs/OPERATIONS.md).

## Trạng thái hiện tại

- **Hạ tầng (region `ap-southeast-2`, account `451058046864`):** stack `00`–`04` và `99-unverified-gpu` đã apply. Stack `01-foundation` **chưa** được apply lại (state lệch với cluster, xem mục GPU).
- **Image đang chạy:** BFF `dev-pgfix-1104`, dashboard `dev-p6-1104`, CPU `dev-8d0469b`, GPU `dev-3f1cd93`.
- **Hub:** `enable_auth_state=false` (user không cần vào JupyterHub để kích hoạt). Cognito client của Hub đã xoay; client cũ đã xóa.
- **Git:** PR #3 đã merge vào `master` lúc 2026-11-04 16:37Z. Các commit sau đó trên `feat/dashboard-team-management` (lời mời, usage, sửa RETURNING, test tích hợp, docs) **chưa** nằm trên `master`.
- **Test:** BFF `npm test` 107/107; test tích hợp Postgres 14/14 (chạy tay); test helper dashboard qua `npm test`.

## Cần người dùng

- ⚠️ **E2E trên trình duyệt với tài khoản thật:** đã kiểm: đăng nhập dashboard, tạo Project, start sandbox, bấm "Mở notebook" qua handoff → JupyterLab (không qua UI Hub). Đã kiểm: mã handoff dùng lại bị từ chối; tạo team; upload và tải artifact (nội dung khớp); trang Usage hiển thị số sandbox đang chạy. Sửa trong lượt này: đăng xuất dashboard nay cũng chuyển qua `/hub/logout` (đã kiểm: sau `/hub/logout` notebook không mở được). Chưa kiểm: nút đăng xuất trên UI (cần đăng nhập lại), lời mời được chấp nhận bởi người khác (cần tài khoản thứ hai).
- ✅ Usage: CPU và RAM đã cấp phát đọc từ pod spec (BFF có Role đọc pod trong namespace `hub`). Đã kiểm: sandbox 2 cores, 4 GB.
- ☐ **Logo và brand pack (phase 8):** người dùng chọn concept logo.
- ☐ **Mở PR cho các commit chưa merge** trên `feat/dashboard-team-management` (sau khi có xác nhận).

## Đã xong (đã kiểm chứng ở mức code/deploy)

- ✅ Hạ tầng 00–04 và Route53/ACM cho `mlbox.june8th.me`.
- ✅ Auth Cognito qua BFF (register, confirm, login, logout, refresh, forgot/reset, change password), CSRF, session cookie.
- ✅ Turnstile cho register và checkout, bật theo cấu hình.
- ✅ Hub spawn không cần auth state (BFF làm việc spawn).
- ✅ Mở notebook qua mã handoff một lần (60 giây, chỉ lưu hash, chỉ dùng được một lần); người dùng không vào UI Hub. Hub dùng `MlBoxBffAuthenticator`, BFF là cổng kiểm soát (`allow_all`).
- ✅ Trạng thái sandbox đọc từ `GET /users/<u>` vì JupyterHub 5 trả 405 với GET named server; `state` có thể là object.
- ✅ Điều hướng: Projects, Teams, Usage, Account; `/sandboxes` chuyển về `/projects`.
- ✅ Personal Space và default Team cho mỗi user; Space switcher trên dashboard.
- ✅ Project: list/create theo Space, phân quyền theo team và direct grant (blocked, manager, contributor, viewer).
- ✅ Team phẳng: tạo, liệt kê, thêm/xóa thành viên, chặn xóa lead cuối cùng.
- ✅ Lời mời Space: owner/admin mời, thu hồi; người được mời chấp nhận đúng email (không gửi email).
- ✅ Sandbox theo Project: đọc, start, stop; runtime chạy dưới Hub user của owner Project.
- ✅ Artifact (MVP): metadata Postgres; upload/download qua presigned URL; key dưới `spaces/{space}/projects/{project}/`.
- ✅ Cách ly workspace: role workspace của hub chỉ `users/*`, deny `spaces/*`; role BFF chỉ `spaces/*`.
- ✅ Usage (MVP): phiên sandbox từ sự kiện start/stop/observed; tổng giờ theo Project và Space. Không phải dữ liệu thanh toán.
- ✅ GPU: time-slicing `nvidia.com/gpu` (3 replica) trên pool shared; đã chạy `nvidia-smi` trên T4 (g4dn) và ba pod chia sẻ một GPU.

## GPU

- ⚠️ Shared L4 (g6) đã bật profile nhưng chưa spawn được end-to-end: AWS thiếu capacity g6 ở các AZ đã thử. Đã kiểm chứng trên g4dn; đã trả NodePool về g6.
- ☐ Kiểm tra hook VRAM balloon trên pod thật (chưa có pod nào spawn qua profile GPU).
- ☐ Bật `serviceMonitor` của dcgm-exporter khi cluster có Prometheus CRD; kiểm tra metric thật.
- ⚠️ **State `01-foundation` lệch cluster:** plan muốn destroy fck-NAT, tạo NAT gateway, thay IAM. Label `nvidia.com/device-plugin.config=any` trên NodePool `gpu-shared-l4` đã được patch tay. Cần reconcile trước khi apply `01` lại.
- ☐ Cập nhật tài liệu thiết kế GPU: `renameByDefault=false` là quyết định mới (xem `terraform/modules/gpu-stack`).

## Dashboard và BFF (còn thiếu)

- ☐ Tạo organization Space self-serve (hiện tạo bằng SQL).
- ☐ Gửi email lời mời (hiện chỉ ghi nhận trong hệ thống).
- ☐ UI quản lý quyền Project (manager/contributor/viewer/blocked) và thu hồi quyền có hiệu lực ngay.
- ☐ Đổi profile sandbox; đổi tên/xóa Project; Project settings.
- ☐ Xóa artifact; phân trang danh sách.
- ☐ Enforce quota CPU/RAM/storage/GPU. Chỉ làm khi nguồn usage đủ tin cậy.
- ☐ Thanh toán thật: không trong phạm vi hiện tại.
- ✅ Đã xoay secret lộ trong output plan: client Cognito `jupyterhub` (thay mới), `HUB_AUTH_BRIDGE_TOKEN`, `BFF_SESSION_SECRET` (mọi phiên cũ mất hiệu lực).
- ⚠️ Redesign giao diện: đã đổi token sáng sang tông kem ấm (accent đất nung) và copy trang chủ. Còn lại: shell (rail, header), các màn Projects/Project/Teams/Usage/Account, auth, Hub; chụp trước/sau ở mobile, tablet, desktop, sáng/tối, en/vi.
- ☐ Turnstile: test đầy đủ disabled/enabled/token sai/hết hạn/replay/Siteverify lỗi.
- ☐ Form `/verify` và các màn hình còn mock; kiểm tra a11y, responsive, en/vi cho các màn mới.

## Cách ly và bảo mật

- ☐ Runtime user (notebook) chưa có sidecar đồng bộ `users/<id>/`. Khi thêm, phải dùng session policy riêng cho từng user (không dùng role workspace trực tiếp).
- ☐ Kiểm tra cross-tenant trên cluster thật với hai danh tính thật (`web/bff/test/authz-matrix.md`).
- ☐ Review IAM least privilege: Terraform, LB controller, Karpenter, hub, BFF.
- ☐ Secret management: chuyển secret Hub/BFF sang Kubernetes Secret có kiểm soát hoặc Secrets Manager. Xoay mọi secret đã từng hiển thị trong log hoặc output.
- ☐ NetworkPolicy và egress policy cho namespace dashboard/BFF.
- ☐ Scan dependency/container; ký image và provenance.

## Test và CI

- ✅ BFF unit test (`npm test`), test tích hợp Postgres (`npm run test:integration`, cần `DATABASE_URL`).
- ☐ Đưa test tích hợp Postgres vào CI (hiện chạy tay).
- ☐ Test dashboard cho component và route (hiện chỉ có test helper).
- ☐ Kế hoạch CI/CD: `.github/workflows/*.disabled` chưa được bật; build, scan, push và rollout có approval.

## Vận hành

- ☐ Monitoring/alert cho EKS, ALB, target health, pod restart, RDS, quota GPU.
- ☐ Log retention, audit trail và hướng dẫn điều tra incident.
- ☐ Backup/restore test cho RDS, S3 workspace và Terraform state.
- ☐ Budget và cost anomaly alert; quy trình dừng lab khi không dùng.
- ☐ Runbook và rollback cho các tính năng mới (team, lời mời, sandbox theo Project, artifact, usage).
- ☐ Acceptance checklist cho release dashboard và BFF trước khi tuyên bố production-ready.

## Phase còn lại của kế hoạch multi-tenant

- ⚠️ Phase 6 (subscription và usage): mock subscription có; usage là MVP từ sự kiện BFF. Ledger chính xác cần nguồn dữ liệu đã kiểm chứng.
- ☐ Phase 7: Turnstile theo luồng (xem mục Dashboard).
- ☐ Phase 8: logo, brand pack, token dùng chung; Space switcher đã có.
- ☐ Phase 9: release hardening, migration/backup/restore, runbook, rollback.

## Tài liệu

- ✅ Đã xóa các tài liệu đã hoàn thành hoặc đã bị thay thế (brief ban đầu, plan/spec 29/10, plan hub-provisioning-adapter). Lịch sử vẫn có trong git.
- ☐ Cập nhật tài liệu sau mỗi thay đổi public URL, stack output, image tag hoặc auth flow.
