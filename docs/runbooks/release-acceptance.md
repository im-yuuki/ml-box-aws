# MLBox — Release acceptance checklist (dashboard + BFF)

> Cập nhật 2026-11-14. Dùng trước mỗi lần deploy/release của dashboard và BFF.
> Quy trình build/rollout: [`docs/DEPLOYMENT.md`](../DEPLOYMENT.md). Vận hành: [`docs/OPERATIONS.md`](../OPERATIONS.md).

## Trước release

- [ ] Mã nguồn đã merge về `master`; image publish tự động lên GHCR (`.github/workflows/images.yml`).
- [ ] Pin đủ hai image: `ghcr.io/im-yuuki/mlbox-{dashboard,bff}:<full-sha>` (xem `04-dashboard/terraform.tfvars` hoặc stack output tương ứng).
- [ ] `terraform -chdir=terraform/stacks/04-dashboard plan` — chỉ diff image; không destroy/replace tài nguyên ngoài ý muốn.
- [ ] Migration DB (nếu có): chạy `npx tsc -p web/bff && node dist/migrate.js` hoặc tương đương trước khi bật image mới; kiểm tra migration `units_per_hour` trên usage cũ nếu liên quan.
- [ ] Backup RDS (snapshot thủ công cho instance hub + usage) trước release thay đổi schema.
- [ ] Người thứ hai review plan + checklist này lần cuối (không tự-block).

## Apply & smoke sau rollout (bắt buộc)

- [ ] `kubectl -n dashboard rollout status deployment/dashboard deployment/bff --timeout=300s`
- [ ] `kubectl -n dashboard get pods` — cả hai deployment Ready.
- [ ] ALB target healthy: `aws elbv2 describe-target-health --target-group-arn "$(terraform -chdir=terraform/stacks/04-dashboard output -raw dashboard_target_group_arn)"`
- [ ] `curl -s -o /dev/null -w '%{http_code}\n' https://mlbox.june8th.me/` — 200 (không chỉ 200 cho `/`, mà cả `/login`).
- [ ] **Login thật**: đăng nhập bằng tài khoản QA → dashboard load, `/quota` hiển thị units.
- [ ] **Tạo Project** mới trong Personal Space → xuất hiện trong list.
- [ ] **Start sandbox** từ Project → chờ Hub server Running; mở notebook bằng handoff link (một lần), ghi file, stop sandbox, start lại, đọc lại file (EFS).
- [ ] **Stop sandbox** → state về Stopped; units usage cập nhật.
- [ ] **Artifact**: upload file nhỏ → download lại, so SHA256.
- [ ] **Admin console**: `curl -k ... https://admin.<domain>/healthz` — 200; đăng nhập admin, `/healthz`, operations, audit có dữ liệu.
- [ ] **Log**: `kubectl -n dashboard logs deployment/bff --since=5m` — không error bất thường; `kubectl -n hub logs deployment/hub --since=5m`.
- [ ] **Alert**: nếu GPU smoke còn active, kiểm tra Prometheus `/targets` và `/rules` (kube-prometheus-stack); xoá pod gpu-smoke khi xong.

## Rollback

- [ ] Pin lại image tag known-good trong `terraform.tfvars`; `terraform -chdir=terraform/stacks/04-dashboard plan` — chỉ diff image.
- [ ] `terraform apply`, theo dõi rollout; lặp lại smoke tối thiểu (login, /quota).
- [ ] Nếu migration đã chạy và schema tương thích ngược: không cần rollback schema. Nếu không, khôi phục RDS từ snapshot trước release (xem `docs/OPERATIONS.md`).
- [ ] Ghi post-mortem ngắn vào TODO/docs nếu rollback do lỗi deploy.

## CD (hiện tại)

- CD KHÔNG tự động apply. `images.yml` chỉ build/push GHCR. `.github/workflows/deploy.yml.disabled` vẫn tắt.
- Lý do giữ: rollout cần (1) backup RDS trước release, (2) plan review + apply thủ công, (3) smoke thủ công, (4) rollback thủ công có kiểm chứng.
- Hướng đi khi cần CD: bật GitHub Environment `production` với required reviewers → job `terraform apply` chỉ chạy sau approval; smoke check script trong workflow; rollback thủ công theo checklist trên. Chưa tạo trước khi có người vận hành thứ hai.

## Runbook tính năng

Chi tiết theo tính năng: `docs/runbooks/features.md`.

## Trạng thái kiểm chứng (2026-11-14)

Chạy thật trên production với tài khoản QA tạm (mail.tm): register → confirm → login → tạo project → start sandbox (c1.large CPU) → notebook handoff → ghi file `e2e_canary.txt` → stop → start lại → file còn nguyên (EFS OK) → upload artifact 31B → download về nội dung khớp → /quota (số liệu thật 19.9/20) → admin `/healthz` `{"ok":true}` → xóa project → xóa tài khoản Cognito test.

Chưa kiểm chứng:
- **Mail verification code flow** — confirmation mail không đến disposable inbox (Cognito default sender); dùng `admin-confirm-sign-up` để test. Nếu cần verify email thật, cấu hình SES custom sender.
- Rollback end-to-end (pin tag cũ + apply + smoke) — chưa thực hiện; checklist đã có phần Rollback.
- Người thứ hai làm theo runbook — chưa kiểm chứng.