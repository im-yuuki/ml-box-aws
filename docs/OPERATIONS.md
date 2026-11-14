# MLBox — Operations Runbook

Tài liệu này mô tả các thao tác vận hành thường ngày cho MLBox trên AWS EKS. Quy trình hiện tại
mặc định dùng account `451058046864`, region `ap-southeast-2` và cluster
`jhub-gpu-sandbox-dev-apse2`.

## Trạng thái và nguyên tắc vận hành

- JupyterHub là notebook/API backend tại `https://notebook.mlbox.june8th.me`.
- Dashboard là public frontend tại `https://mlbox.june8th.me`.
- Luồng bắt buộc đã được redeploy fresh; CPU baseline đang chạy trên cluster
  `jhub-gpu-sandbox-dev-apse2`.
- E2E production đã kiểm chứng (2026-11-14): register → confirm → login → project → sandbox →
  notebook (handoff) → artifact → `/quota` (tài khoản QA tạm, đã xoá). Mail xác nhận mã đã kiểm
  chứng lại cùng ngày (2026-11-14, mục 21) — nhưng Cognito vẫn gửi bằng sender mặc định
  (`COGNITO_DEFAULT`) nên deliverability tới disposable inbox không ổn định; cân nhắc SES trước
  khi mở rộng.
- Dashboard production đã được xác nhận qua ALB: `/` và `/login` trả `200`, target healthy,
  không còn lỗi `DYNAMIC_SERVER_USAGE`. BFF readiness nội bộ `/v1/health` trả `200` **và** ping được
  Postgres (trả `503` khi DB không truy cập được). Liveness dùng `/v1/health/live` (chỉ kiểm tra config,
  không chạm DB, để DB sự cố không làm kubelet restart pod).
- GPU: stack `05-gpu` (tên cũ `99-unverified-gpu`) đã apply; profile GPU trong hub đã bật. Shared pool
  chạy g4dn (T4): time-slicing 2 replica @ 8GB commit, `renameByDefault=false`; L4 (g6) vẫn chờ capacity
  AWS. Đã kiểm chứng time-slicing trên g4dn, gồm cả dcgm metrics qua kube-prometheus-stack.
- Luôn pin image bằng tag immutable là commit SHA đầy đủ (40 hex). Không dùng `latest` cho rollout.
- Không sửa hoặc xóa state Terraform, secret, backend config hay resource production thủ công nếu
  chưa xác định stack sở hữu resource đó.
- Bốn KMS key lịch sử của project đã được xác nhận không còn alias/grant sử dụng và đang ở
  `PendingDeletion`; đây là trạng thái cleanup đúng của AWS. Không cancel deletion, vì KMS bắt
  buộc giữ waiting period trước khi xóa vĩnh viễn. Các key hiện tại của workspace/cluster vẫn
  do stack mới quản lý.

## Quyền truy cập và context

```bash
aws login                                  # SSO, phiên dùng cho cả CLI và Terraform
aws sts get-caller-identity
aws eks update-kubeconfig \
  --name jhub-gpu-sandbox-dev-apse2 \
  --region ap-southeast-2
kubectl config current-context
```

Terraform đọc profile qua biến môi trường. Trên Windows dùng wrapper `.private\aws-env.cmd` (file cục bộ, không commit): `.private\aws-env.cmd terraform -chdir=terraform/stacks/02-platform plan`. Trên macOS/Linux: `export AWS_PROFILE=AdministratorAccess-<account-id>` và `export AWS_REGION=ap-southeast-2`. Nếu phiên đăng nhập hết hạn, chạy lại `aws login` trước khi chạy lệnh Terraform/AWS. Không đưa output token, cookie hay secret vào issue/log/commit.

## Health check nhanh

Chạy từ repository root:

```bash
kubectl get nodes
kubectl get pods -A
kubectl -n hub get pods,svc,targetgroupbinding
kubectl -n dashboard get pods,svc,targetgroupbinding

curl -sS -o /dev/null -w 'notebook: %{http_code}\n' \
  https://notebook.mlbox.june8th.me/hub/login
curl -sS -o /dev/null -w 'dashboard: %{http_code}\n' \
  https://mlbox.june8th.me/
```

Kỳ vọng tối thiểu:

- Node system và node CPU ở trạng thái `Ready`.
- `hub` và `dashboard` deployment có pod `Running`/`Ready`.
- Notebook trả `200` hoặc redirect hợp lệ tới login.
- Dashboard chỉ được coi là healthy khi `/`, `/login` và các route chính trả `200` trong
  production, không chỉ trong `next dev`.

Kiểm tra TargetGroupBinding và ALB target health:

```bash
kubectl -n hub get targetgroupbinding
kubectl -n dashboard get targetgroupbinding
terraform -chdir=terraform/stacks/04-dashboard output -raw dashboard_target_group_arn
aws elbv2 describe-target-health \
  --target-group-arn "$(terraform -chdir=terraform/stacks/04-dashboard output -raw dashboard_target_group_arn)"
```

## Xem log và debug rollout

### Kubernetes logs

```bash
kubectl -n hub get pods
kubectl -n hub logs deployment/hub --since=15m
kubectl -n hub logs deployment/hub --since=15m --all-containers
kubectl -n dashboard logs deployment/dashboard --since=15m
kubectl -n dashboard describe pod -l app=dashboard
```

Theo dõi rollout:

```bash
kubectl -n hub rollout status deployment/hub --timeout=300s
kubectl -n dashboard rollout status deployment/dashboard --timeout=300s
kubectl -n hub get events --sort-by=.lastTimestamp | tail -30
kubectl -n dashboard get events --sort-by=.lastTimestamp | tail -30
```

Nếu pod `Pending`, kiểm tra NodePool, quota, taint/toleration, resource request và event của pod.
Nếu pod `CrashLoopBackOff`, xem log container trước và container hiện tại, sau đó kiểm tra image/tag,
secret và environment.

### ALB/target timeout hoặc unhealthy

Phân biệt nguyên nhân theo `TargetHealth.Reason`:

- `Target.Timeout`: kiểm tra Service/TGB, port container, route, node security group và pod có listen
  trên đúng port.
- `Target.ResponseCodeMismatch`: ALB đã tới được pod nhưng application trả status ngoài matcher.
  Curl trực tiếp qua Service và xem application log.
- `Target.NotRegistered`: TGB chưa reconcile hoặc service/port name không khớp.
- `Target.FailedHealthChecks`: kiểm tra health check path và readiness của application.

Dashboard dùng target port `3000`; hub proxy dùng port `8000`. Không mở rộng CIDR public chỉ để
khắc phục health check; traffic ALB → node phải dùng security group reference.

## Rollout image an toàn

1. Build image từ repository root theo hướng dẫn trong [`scripts/README.md`](../scripts/README.md).
2. Push tag immutable lên GHCR (`ghcr.io/<owner>/mlbox-*`).
3. Cập nhật image tag trong `terraform.tfvars` của stack tương ứng.
4. Chạy `terraform plan` và review chỉ thay đổi image.
5. Apply stack, theo dõi rollout và health check.
6. Giữ tag cũ để rollback.

Hub image và dashboard image có quy trình riêng trong [`docs/DEPLOYMENT.md`](DEPLOYMENT.md).
Không xóa image đang được deployment hoặc rollback sử dụng.

Rollback application:

```bash
# Cập nhật tag đã biết tốt trong terraform.tfvars trước
terraform -chdir=terraform/stacks/03-hub-app plan
terraform -chdir=terraform/stacks/03-hub-app apply

terraform -chdir=terraform/stacks/04-dashboard plan
terraform -chdir=terraform/stacks/04-dashboard apply
```

Không dùng `kubectl edit` làm thay đổi lâu dài; nếu cần emergency patch, ghi lại thay đổi và đồng bộ
lại Terraform ngay sau đó.

## Phase 3 Hub identity migration dry-run

The BFF identity rollout is compatibility-only until the production safeguards below are complete. The dry-run is read-only: it reads `mlbox_hub_identities`, reports canonical username candidates and collisions, and never renames or deletes Hub users or changes sandbox ownership.

Before running against production:

1. Take and verify an app database backup.
2. Confirm the backup restore procedure and record the change/rollback owner.
3. Review every reported conflict manually; a conflict must block migration.
4. Prepare the rollback record and obtain an approved Terraform/deployment plan.

Run from `web/bff` with a redacted database URL supplied through the environment:

```bash
export APP_DATABASE_URL='postgres://<REDACTED>'
npm run build
npm run identity:dry-run
```

Exit codes:

- `0`: report completed and no identity conflicts were found.
- `1`: required database URL is missing or the report could not be produced.
- `2`: report completed but one or more conflicts require manual review.

A zero exit code does not authorize a production migration. Do not add a multi-row apply step until backup, collision review, transactional migration/rollback, valid Terraform plan, rollout, and post-migration E2E verification are complete.

## JupyterHub operations

```bash
kubectl -n hub get pods,svc,configmap,secret,targetgroupbinding
kubectl -n hub get deployment hub -o wide
kubectl -n hub rollout restart deployment/hub
kubectl -n hub rollout status deployment/hub --timeout=300s
```

Chỉ restart khi đã xem log và hiểu ảnh hưởng. Sau restart kiểm tra:

```bash
curl -sS -o /dev/null -w '%{http_code}\n' \
  https://notebook.mlbox.june8th.me/hub/login
kubectl -n hub get targetgroupbinding
```

Hub đã bật GPU profiles (`enable_gpu_profiles=true`); stack `05-gpu` (tên cũ `99-unverified-gpu`)
và image GPU phải giữ trạng thái applied. Shared pool chạy g4dn (T4) — L4 (g6) vẫn chờ capacity AWS.

## Dashboard operations

```bash
kubectl -n dashboard get deployment,service,targetgroupbinding,pods
kubectl -n dashboard rollout status deployment/dashboard --timeout=300s
kubectl -n dashboard logs deployment/dashboard --tail=100
curl -i https://mlbox.june8th.me/
curl -i https://mlbox.june8th.me/login
```

Các chức năng hiện có mức độ hoàn thiện khác nhau:

- Login/register/confirm/logout đã test thật trên production với tài khoản QA tạm (2026-11-14);
  verify code qua mail **đã kiểm chứng lại** cùng ngày: mã 6 số từ mail.tm (domain fldubai.com)
  nhận được, confirm → 200, login OK. Lưu ý: Cognito dùng sender mặc định (`COGNITO_DEFAULT`) nên
  deliverability tới disposable inbox không ổn định — cân nhắc SES trước khi mở rộng.
- BFF verify JWT, mã hóa session cookie và proxy list/start/stop tới JupyterHub; readiness chỉ đạt
  khi Secret, remote state và Hub service token đã được cấu hình.
- Sandboxes dùng API thật cho list/start/stop và profile khi sandbox dừng; trang `/quota` hiển thị
  usage/quota thật theo Space đang chọn. Billing vẫn là mock (credits, không thanh toán thật).

## Cognito và session

Thông tin pool/client có thể lấy từ Terraform output, không hard-code secret vào source:

```bash
terraform -chdir=terraform/stacks/02-platform output
```

Dashboard client là public client, không có client secret. Khi triển khai auth thật cần kiểm tra
Cognito user pool, app client flows, callback/allowed origins và cookie/session policy. Không log
access token, refresh token, password hoặc mã OTP.

Test user dùng cho QA phải được xóa hoặc disable sau khi kiểm tra. Không đưa email/password test vào
repo hoặc tài liệu public.

## Admin console

Dashboard vận hành cho một quản trị viên, tại `https://admin.<domain>` (stack `07-admin`, mã nguồn `web/admin`).
Đăng nhập riêng, không qua Cognito. Hiển thị health, sandbox, user, audit, workload, năng lực (quota vCPU, GPU), lưu trữ,
billing và tài nguyên AWS bằng IAM role của pod (IRSA), không dùng access key. Chỉ-đọc mặc định; `enable_actions` bật bốn
thao tác hỗ trợ (dừng sandbox, đăng xuất/khóa user, đổi gói), mỗi thao tác cần lý do và được ghi vào `mlbox_admin_audit`.

```bash
kubectl -n admin get pods,svc,targetgroupbinding
kubectl -n admin logs deployment/admin-console --since=15m   # nhật ký thao tác của quản trị viên
```

Đổi mật khẩu: tạo hash bằng `npm run hash-password` trong `web/admin`, cập nhật `admin_password_hash`, apply `07-admin`.
Chi tiết: [`web/admin/README.md`](../web/admin/README.md), [`terraform/stacks/07-admin/README.md`](../terraform/stacks/07-admin/README.md).

Stack `07-admin` cần `state_bucket` trong `terraform.tfvars` (bắt buộc, không còn giá trị mặc định) và
`admin_password_hash` theo định dạng `scrypt$N$r$p$salt$hash`. Tạo hash bằng `npm run build` rồi
`ADMIN_PASSWORD='...' npm run hash-password` trong `web/admin`.

Apply lại sau khi đổi mật khẩu hoặc đổi image:

```bash
terraform -chdir=terraform/stacks/07-admin init -reconfigure -backend-config=backend.hcl
terraform -chdir=terraform/stacks/07-admin plan
terraform -chdir=terraform/stacks/07-admin apply
kubectl -n admin rollout status deployment/admin-console --timeout=300s
```

Console chỉ đọc với `enable_actions = false` (mặc định): không dừng được notebook, không khoá được
tài khoản. Bật `enable_actions` là một quyết định riêng và mọi thao tác đều ghi vào
`mlbox_admin_audit`.

## Locale và theme

Dashboard locale dùng cookie `mlbox-locale`, hỗ trợ `en` và `vi`. Kiểm tra sau khi đổi locale bằng
cách mở lại trang và xem cookie, không dùng cookie để lưu credentials.

Notebook theme được apply bằng:

```bash
./deploy/apply-hub-theme.sh
```

Script apply ConfigMap theme vào namespace `hub`, restart deployment theo mặc định và kiểm tra mount.
Sau khi đổi theme, kiểm tra cả Hub và Lab trên notebook URL. Có thể bỏ restart chỉ khi đã hiểu rằng
pod hiện tại chưa nhận ConfigMap mới.

## DNS, TLS và ALB

Route53 là authoritative DNS hiện tại cho `mlbox.june8th.me`; Cloudflare/registrar chỉ giữ vai trò
delegation/nameserver theo quy trình trong [`deploy/DNS-CLOUDFLARE.md`](../deploy/DNS-CLOUDFLARE.md).

Kiểm tra:

```bash
aws route53 list-resource-record-sets \
  --hosted-zone-id <zone-id> \
  --query "ResourceRecordSets[?contains(Name, 'mlbox.june8th.me')]"

aws acm list-certificates --region ap-southeast-2
aws elbv2 describe-listeners --load-balancer-arn <alb-arn>
```

Không tạo listener/certificate/DNS record ngoài Terraform nếu resource đó thuộc stack. Khi ACM ở
trạng thái `PENDING_VALIDATION`, dừng luồng triển khai và kiểm tra delegation/TXT record trước khi
apply stack tiếp theo.

## Terraform state và backup

Các stack dùng remote state S3 và lock DynamoDB do `00-bootstrap` tạo. Trước thao tác state:

```bash
aws s3api list-object-versions \
  --bucket jhub-gpu-sandbox-tfstate-451058046864 \
  --prefix dev/ap-southeast-2/
aws dynamodb describe-table --table-name jhub-gpu-sandbox-tflock
```

Trước `terraform init` ở stack mới, xác minh object
state cũ và backup/versioning. Không chạy `apply` nếu Terraform vừa khởi tạo một state rỗng —
xác minh `backend.hcl` trỏ đúng bucket/key (xem mục 5 và 13 của [`docs/DEPLOYMENT.md`](DEPLOYMENT.md)).

`00-bootstrap` giữ state local trong thư mục stack và file đó phải được backup riêng. Nếu mất state
local này, `00-bootstrap` không còn `plan`/`destroy` được cho tới khi `terraform import` lại zone
Route53, hai chứng thư ACM, bucket state, bảng lock và các bản ghi validation. `06-storage`,
`07-admin` và `08-alerting` dùng backend do `00-bootstrap` sinh ra
(`08-alerting` được thêm vào bản sinh backend.hcl từ 2026-11-14; trước đó tạo tay theo
`terraform/stacks/08-alerting/backend.hcl.example`). Nếu thiếu `backend.hcl`, tạo tay theo mẫu
`backend.hcl.example` tương ứng.

Không chạy `terraform force-unlock` nếu chưa xác định lock owner. Không xóa bucket state, lock table
hoặc version cũ trong khi còn workload.

## Log tập trung (cập nhật 2026-11-14)

- **Đã triển khai**: Fluent Bit DaemonSet (namespace `amazon-cloudwatch`, release `aws-fluent-bit`) đẩy log toàn bộ container trong cluster vào CloudWatch Logs group **`/mlbox`** (retention 30 ngày, streams đặt tên `<ns>.<pod>.<container>`).
- Subgroup thông thường: hub logs, BFF errors, dashboard UI, Karpenter events, admin console (audit log vẫn lưu Postgres — xem phía dưới).
- Audit admin console (2026-11-14): lưu Postgres (`mlbox_audit_events`) và được **export** ra stdout mỗi 15 phút bởi CronJob `audit-export` (namespace `dashboard`, image bff pinned SHA 61c50836..., bảng watermark `mlbox_audit_export_state`) — fluent-bit ship vào `/mlbox` với stream `dashboard.audit-export-*.audit-export`. Truy vấn nhanh: `aws logs filter-log-events --log-group-name /mlbox --filter-pattern AUDIT_EXPORT_DONE --limit 5`.
- Production-hardening thêm: metric filter + alarm cho 5xx errors trong `/mlbox` (chưa làm); per-app log group split (chưa làm).

Query bằng CloudWatch Logs Insights (ví dụ tìm lỗi của user trong 30 phút):

```bash
aws logs start-query --log-group-name /mlbox \
  --start-time $(date -d '30 minutes ago' +%s) --end-time $(date +%s) \
  --query-string 'fields @timestamp, @message | filter @message like /timeout|error/ | sort @timestamp desc | limit 50'
```

Sau đó `aws logs get-query-results --query-id <id>`.

Xem nhanh bằng kubectl (vẫn hợp lệ): `kubectl -n hub logs deployment/hub --since=15m`, `kubectl -n dashboard logs deployment/bff --since=15m`, `kubectl -n karpenter logs deployment/karpenter --since=15m`.

Khuyến nghị thêm (chưa làm): separate log group `/mlbox/audit` cho admin console audit export, và metric filter alerting cho 5xx errors.

## Chi phí và dừng lab

Đây là lab có chi phí EKS, NAT, node, EBS, RDS và ALB. Khi không dùng:

- Dừng workload/user server trước.
- Kiểm tra node và volume còn tồn tại.
- Nếu cần tạm dừng dài ngày, dùng quy trình destroy có kiểm soát, giữ remote state.
- Destroy theo thứ tự phụ thuộc: (monitoring/08-alerting — dọn bằng Helm + `08-alerting destroy` trước)
  `07-admin` → `05-gpu` → `04-dashboard` → `03-hub-app` → `06-storage` → `02-platform` → `01-foundation`.
- Xoá bucket workspace trước khi destroy `02-platform`: `aws s3 rb s3://<bucket-workspace> --force --region <region>` (bucket bật versioning nên phải xoá cả version cũ, nếu không sẽ lỗi `BucketNotEmpty`).
- Tắt `dashboard_usage_deletion_protection` (đặt `false` trong `terraform.tfvars` của `02-platform`) trước khi destroy, nếu không RDS trả `Cannot delete protected DB`.
- Destroy `01-foundation` có thể kẹt ở data source EKS: dùng `terraform destroy -refresh=false`, rồi dọn node/volume/EC2 còn sót.
- Không destroy `00-bootstrap` trước khi backup toàn bộ state.

Luôn chạy `terraform plan` trước destroy và lưu plan/output phục vụ khôi phục.

## Monitoring (Prometheus, 2026-11-14)

kube-prometheus-stack cài trong namespace `monitoring` (values trong `monitoring/kube-prometheus-stack-values.yaml`).
DCGM exporter scrape job `dcgm-exporter` chỉ hiển thị targets khi có GPU node (gpu-shared min=0); stack dcgm-exporter mở rộng sang tier `dedicated` và serviceMonitor bật.
Alertmanager route tất cả alerts → SNS topic `jhub-gpu-sandbox-dev-apse2-mlbox-alerts` qua IRSA. Subscription email `me@june8th.eu.org` **đã xác nhận** (`PendingConfirmation=false`, kiểm lại 2026-11-14 bằng `sns get-subscription-attributes`). Kiểm tra trạng thái delivery bằng CloudWatch metric `AWS/SNS NumberOfMessagesPublished/Failed`.

Các thao tác thường dùng:

```bash
# Port-forward Prometheus (cần python/curl, hoặc browser)
kubectl -n monitoring port-forward prometheus-kube-prometheus-stack-prometheus-0 9090:9090
# Sau đó mở http://localhost:9090 (ví dụ /targets, /graph, /rules)

# Port-forward Alertmanager
kubectl -n monitoring port-forward alertmanager-kube-prometheus-stack-alertmanager-0 9093:9093

# Kiểm tra dcgm target
kubectl -n gpu-operator-resources get servicemonitor
kubectl -n gpu-operator-resources get pods
```

GPU smoke test (giống quy trình đã dùng để kiểm chứng metric):

```bash
kubectl apply -f monitoring/gpu-smoke.yaml   # pod chờ GPU node scale-up g4dn.xlarge
kubectl wait pod gpu-smoke --for=condition=Ready --timeout=240s
python ... query "DCGM_FI_DEV_GPU_UTIL"       # hoặc dùng UI http://localhost:9090
kubectl delete pod gpu-smoke                  # node consolidate sau ~5 phút
```

Cảnh báo `GpuXidError` chỉ có dữ liệu khi đã xảy ra Xid error (gauge xuất hiện theo yêu cầu từ NVIDIA).
Cảnh báo GPU node churn (`GpuNodeChurn`) đếm số node GPU thay đổi trong 1h.

## Incident checklist

1. Ghi thời điểm, URL, status code, stack/image tag và thay đổi gần nhất.
2. Xác định lỗi nằm ở DNS/TLS, ALB target, Kubernetes service/pod hay application.
3. Chụp lại `kubectl get`, `describe`, events, logs và `describe-target-health`.
4. Log Karpenter: `kubectl -n karpenter logs deployment/karpenter --since=15m`; events: `kubectl get events -A --sort-by=.lastTimestamp | tail -50`.
5. Audit admin console: `psql $USAGE_DATABASE_URL -c "SELECT created_at, actor_user_id, action, target, metadata FROM mlbox_audit_events ORDER BY created_at DESC LIMIT 50"` hoặc tìm trong `/mlbox` bằng CloudWatch Logs Insights với `filter @message like /mlbox_audit_events/`.
   (Truy cập qua pod có psql client; ví dụ `kubectl -n dashboard exec deploy/bff` + `pg` từ module, hoặc một pod tạm dùng image `postgres:16-alpine` nối DB.)
6. Rollback image hoặc Terraform thay đổi gần nhất nếu có bản known-good.
7. Không xóa resource/state để “dọn lỗi” khi chưa có backup.
8. Sau khi phục hồi, cập nhật [`TODO.md`](../TODO.md) và tài liệu nếu phát hiện gap mới.

## Giới hạn đã biết

- GPU: quota On-Demand G/VT = 8 vCPU; stack `05-gpu` đã apply và hub đã bật GPU profiles; spawn GPU qua
  g4dn (T4) đã kiểm chứng (`nvidia-smi`, time-slicing 2 replica @ 8GB commit, dcgm metrics). L4 (g6) vẫn
  chờ capacity AWS. Metric filter 5xx trong `/mlbox` chưa làm; quota GPU G/VT chưa có alert (cần CloudWatch Usage metric hoặc quotas API).
- Monitoring: metrics/alert rules GPU (kube-prometheus-stack, namespace `monitoring`) + Alertmanager → SNS +
  CloudWatch alarms (ALB, RDS — **9** alarms, tất cả OK) đã hoạt động (2026-11-14); log tập trung qua
  Fluent Bit → `/mlbox` (30d, `IncomingBytes` ≈ 26.5 MB ngày 2026-11-13) đã hoạt động; audit admin
  console export qua CronJob `audit-export`. Subscription SNS `me@june8th.eu.org` đã xác nhận.
- Backup/restore: Automatic plan `aws/efs/automatic-backup-plan` **đã cover cả fs hiện tại**
  `fs-070506268c59fa41d` (2 recovery points 2026-11-14) và fs GỐC `fs-0ba6…` (4 recovery points);
  **restore test PASS (2026-11-14)**: vault tự động deny mọi `StartRestoreJob` (policy inline) — restore
  phải đi qua vault + role riêng (`mlbox-backup-restore`, policy `service-role/AWSBackupServiceRolePolicyForRestores`);
  fs mới `available`, size 6144 khớp source. RDS usage instance snapshot → restore → query PASS;
  Terraform state version check PASS + export backup về `.private/state-backup-2026-11-14/`; S3 workspace
  còn 1 version cũ 31 B (`upload-canary.txt`) — không có object sống.
- CI: test tích hợp Postgres đã merge vào `master` (PR #14, workflow `integration-tests.yml`, pass trên
  `master` 11:05Z 2026-11-14) cùng PR #15 (observability). CD (`deploy.yml.disabled`) vẫn tắt — rollout
  thủ công theo DEPLOYMENT.md; cần quyết định rollout có approval.
- Budget và cost anomaly alert: Console có `My Monthly Cost Budget` $50/tháng, mọi notification đang
  **ALARM** (chi thực ~$216.96, forecast ~$591); **Cost Anomaly Detection chưa có monitor nào** (rỗng).
  Budget không nằm trong code (quyết định 2026-11-14 là theo dõi qua Console) — cần quyết định trước
  khi tuyên bố production-ready.
- State local `00-bootstrap` đã mất: không plan/destroy được `00-bootstrap` nếu chưa `import` lại tài nguyên;
  cần export backup state cho mọi account trước khi bàn giao.
