# MLBox — Deployment Runbook

> Cập nhật 2026-11-04. Trạng thái chi tiết và backlog: [`TODO.md`](../TODO.md).

Tài liệu này là quy trình triển khai hiện tại cho một region. Quy trình mặc định được viết cho
`ap-southeast-2` và account `451058046864`; thay các giá trị này nếu triển khai region khác.

## Trạng thái hiện tại

| Thành phần | Trạng thái | Ghi chú |
|---|---|---|
| `00-bootstrap` | ✅ Đã apply fresh | S3 state, DynamoDB lock, Route53 zone, ACM certificates và validation records |
| `01-foundation` | ✅ Đã apply | VPC, EKS, system node group, Karpenter, CPU NodePool |
| `02-platform` | ✅ Đã apply | RDS, Cognito, ALB, Route53 aliases, Load Balancer Controller |
| DNS / ACM | ✅ Hoàn tất | Cloudflare delegate `mlbox` sang Route53; cả hai certificate đều `ISSUED` |
| `03-hub-app` | ✅ Đã apply | JupyterHub tại `notebook.mlbox.june8th.me`, có BFF service token |
| Hub theme | ✅ Đã apply | ConfigMap theme MLBox và rollout Hub |
| `04-dashboard` | ✅ Đã apply | Dashboard + BFF, apex listener rule và healthy target |
| `05-gpu` (tên cũ `99-unverified-gpu`) | ✅ Đã apply | Device plugin (time-slicing `nvidia.com/gpu`) và dcgm-exporter; GPU quota On-Demand G/VT = 8 vCPU |
| `08-alerting` | ✅ Đã apply (2026-11-14) | SNS topic, IRSA roles (alertmanager, fluent-bit), 8 CloudWatch alarms (ALB, RDS) → SNS |
| `monitoring` (kube-prometheus-stack + fluent-bit) | ✅ Đã cài (2026-11-14) | namespace `monitoring` (Prometheus/Alertmanager), `amazon-cloudwatch` (fluent-bit → `/mlbox`) |
| GPU profile trong hub | ⚠️ Đã bật | Đã kiểm chứng trên g4dn (T4); shared L4 (g6) phụ thuộc capacity AWS |
| BFF / dashboard | ✅ Đã deploy, ⚠️ chưa E2E | Health 200; route Project/Team/lời mời/artifact đã có; luồng trình duyệt với tài khoản thật chưa kiểm chứng |

## Thứ tự stack bắt buộc

```text
00-bootstrap → 01-foundation → 02-platform → DNS/ACM pause
             → 03-hub-app → apply hub theme → 04-dashboard
```

`05-gpu` (trước đây là `99-unverified-gpu`) nằm ngoài luồng bắt buộc nhưng đã được apply. Chỉ apply lại
sau khi kiểm tra GPU device plugin, và không apply `01-foundation` cho đến khi reconcile state (xem TODO).

## Prerequisites

```bash
source .private/aws-env.sh
aws sts get-caller-identity
aws eks update-kubeconfig \
  --name jhub-gpu-sandbox-dev-apse2 \
  --region ap-southeast-2
kubectl get nodes
```

Cần có:

- AWS CLI, Terraform `>= 1.6`, `kubectl`, Helm provider credentials, Docker Buildx và Helm CLI (`helm repo add prometheus-community https://prometheus-community.github.io/helm-charts; helm repo add nvidia https://nvidia.github.io/dcgm-exporter/helm-charts; helm repo add eks https://aws.github.io/eks-charts`).
- Quyền truy cập account/region đúng với backend S3.
- Cloudflare chỉ dùng để quản lý nameserver; zone `mlbox.june8th.me` hiện do Route53 quản lý.
- Không commit `backend.hcl`, `terraform.tfvars`, state, plan hoặc secrets.

## One-time bootstrap

```bash
cd terraform/stacks/00-bootstrap
terraform init
terraform plan
terraform apply
```

Stack này tạo state bucket/lock table và sinh `backend.hcl` cho:

- `01-foundation`
- `02-platform`
- `03-hub-app`
- `04-dashboard`
- `05-gpu`

`00-bootstrap` giữ state local; bảo vệ file state và không xóa bucket nếu chưa có bản backup.

## Foundation

```bash
cd ../01-foundation
terraform init -reconfigure -backend-config=backend.hcl
terraform plan
terraform apply
```

Apply có thể mất 15–20 phút. Không ngắt giữa chừng. Sau khi hoàn tất:

```bash
aws eks update-kubeconfig --name jhub-gpu-sandbox-dev-apse2 --region ap-southeast-2
kubectl get nodes
kubectl get nodepools,ec2nodeclasses
```

## Platform

```bash
cd ../02-platform
terraform init -reconfigure -backend-config=backend.hcl
terraform plan
terraform apply
terraform output certificate_status
terraform output -json route53_zone_nameservers
```

Stack tạo ALB, target group, ACM, Cognito, RDS, workspace S3 và Load Balancer Controller.

## DNS và ACM pause

Thực hiện theo [`deploy/DNS-CLOUDFLARE.md`](../deploy/DNS-CLOUDFLARE.md):

1. Lấy nameserver từ output `route53_zone_nameservers`.
2. Đổi nameserver của zone `mlbox.june8th.me` tại registrar/Cloudflare sang Route53.
3. Chờ Route53 authoritative và ACM chuyển sang `ISSUED`.
4. Không apply `03-hub-app` trước khi xác nhận certificate.

Kiểm tra:

```bash
terraform -chdir=terraform/stacks/02-platform output certificate_status
aws acm describe-certificate \
  --certificate-arn "$(terraform -chdir=terraform/stacks/02-platform output -raw certificate_arn)" \
  --query Certificate.Status --output text
```

## Hub application

Trước khi apply, publish CPU image lên GHCR (`.github/workflows/images.yml`) và cập nhật `cpu_image` trong `terraform.tfvars` nếu tag thay đổi.

```bash
cd ../03-hub-app
terraform init -reconfigure -backend-config=backend.hcl
terraform plan
terraform apply
cd ../../
./deploy/apply-hub-theme.sh
```

Kiểm tra:

```bash
kubectl -n hub get pods,svc,targetgroupbinding
kubectl -n hub rollout status deployment/hub --timeout=300s
curl -sS -o /dev/null -w '%{http_code}\n' https://notebook.mlbox.june8th.me/hub/login
```

Kỳ vọng: endpoint notebook trả `200` hoặc redirect hợp lệ tới login; hub dùng CPU profile,
GPU profiles vẫn ẩn.

## Dashboard

Image dashboard phải được build với context repository root và publish lên GHCR trước khi bật
`deploy_dashboard`.

```bash
# Từ repository root
PUSH=1 ./scripts/build-images.sh   # dashboard + bff (+ cpu/gpu nếu cần)

cd terraform/stacks/04-dashboard
terraform init -reconfigure -backend-config=backend.hcl
terraform plan
terraform apply
```

Dashboard không cần build args. Cấu hình Cognito được truyền lúc container chạy
(env do stack `04-dashboard` tạo):

```text
COGNITO_REGION=ap-southeast-2
COGNITO_USER_POOL_ID=<pool-id>
COGNITO_CLIENT_ID=<dashboard-client-id>
```

Kiểm tra Kubernetes và ALB:

```bash
kubectl -n dashboard get pods,svc,targetgroupbinding
kubectl -n dashboard rollout status deployment/dashboard --timeout=300s
aws elbv2 describe-target-health \
  --target-group-arn "$(terraform -chdir=terraform/stacks/04-dashboard output -raw dashboard_target_group_arn)"
curl -i https://mlbox.june8th.me/
```

### Acceptance sau khi redeploy

Lỗi production trước đây là HTTP `500` với digest `DYNAMIC_SERVER_USAGE`, do cookie locale của
`next-intl` kết hợp với `cacheComponents`/`partialPrefetching`. Hai tùy chọn này đã được bỏ khỏi
`web/dashboard/next.config.ts`; isolated production build/start đã trả `200` cho `/`, `/login`
và `/usage` mà không có digest lỗi.

Chỉ đánh dấu dashboard hoàn tất end-to-end sau khi môi trường AWS mới đạt đủ:

- `/` và `/login` trả `200` trong production và ALB target healthy;
- register/confirm/login/logout gọi Cognito thật qua BFF;
- BFF verify session/JWT và proxy được Hub API bằng service token server-side;
- sandbox list/start/stop chạy với user thật và không thể truy cập user khác;
- BFF readiness `/v1/health` trả `200` sau khi Secret và remote states được cấu hình.

## Alerting + centralized logs (08-alerting)

Stack `08-alerting` tạo SNS topic + IRSA roles + 8 CloudWatch alarms (ALB, RDS) + log group `/mlbox`. Không cần apply lại các stack khác.

```bash
cd terraform/stacks/08-alerting
terraform init -reconfigure -backend-config=backend.hcl
terraform plan
terraform apply
```

Sau đó annotate SA (đã làm qua helm trong `monitoring/kube-prometheus-stack-values.yaml`):

```bash
kubectl -n monitoring rollout restart statefulset/alertmanager-kube-prometheus-stack-alertmanager
```

Fluent Bit: `helm install aws-fluent-bit eks/aws-for-fluent-bit -n amazon-cloudwatch --create-namespace -f monitoring/fluent-bit-values.yaml`. Rollback: `helm uninstall aws-fluent-bit -n amazon-cloudwatch` và `terraform -chdir=terraform/stacks/08-alerting destroy` (xóa log group `/mlbox` + SNS topic).

Lưu ý thứ tự: apply stack monitoring (kube-prometheus-stack) + dcgm-exporter **trước**, stack 08 **sau**, fluent-bit cuối. Các giá trị SNS/IRSA trong values cứng cho cluster này.

## GPU (optional)

Monitoring (2026-11-14): kube-prometheus-stack được cài bằng Helm với values `monitoring/kube-prometheus-stack-values.yaml` (chart 45.12.0, namespace `monitoring`). Sau khi stack monitoring sẵn, `05-gpu` apply với dcgm-exporter `serviceMonitor.enabled=true` (biến `enable_dcgm_service_monitor`, mặc định `true`). Lưu ý thứ tự: tạo CRDs (helm) trước khi apply dcgm-exporter, nếu không `serviceMonitor` sẽ fail.


Chỉ chạy sau khi AWS cấp quota cho instance GPU và đã xác nhận image GPU:

```bash
cd terraform/stacks/05-gpu
terraform init -reconfigure -backend-config=backend.hcl
terraform plan
terraform apply

cd ../03-hub-app
# đặt enable_gpu_profiles = true trong terraform.tfvars
terraform apply
```

Sau đó kiểm tra:

```bash
kubectl get nodes -l accelerator=nvidia
kubectl -n kube-system get pods | grep -E 'nvidia|dcgm'
```

## Đổi tên stack và remote state

Tên stack đã đổi từ cấu trúc cũ sang:

```text
03-platform  → 02-platform
04-hub-app   → 03-hub-app
05-dashboard → 04-dashboard
02-gpu       → 99-unverified-gpu → 05-gpu (2026-11-07, sau lần apply đầu)
```

Việc đổi tên thư mục cũng đổi backend key. State cũ có thể vẫn nằm ở các key:

```text
03-platform.tfstate → 02-platform.tfstate
04-hub-app.tfstate  → 03-hub-app.tfstate
05-dashboard.tfstate → 04-dashboard.tfstate
99-unverified-gpu.tfstate → 05-gpu.tfstate (state cũ giữ lại trên S3 làm backup)
```

Migration `02-gpu → 99-unverified-gpu` không kèm migrate state (stack chưa apply lúc đó).
Migration `99-unverified-gpu → 05-gpu` đã chạy `terraform init -migrate-state` với
backend key `dev/ap-southeast-2/05-gpu.tfstate`; object cũ được giữ nguyên làm backup.

Trước lần init đầu tiên sau rename, kiểm tra S3 và backup/versioning. Dùng Terraform migration,
không tự ý xóa state:

```bash
cd terraform/stacks/02-platform
terraform init -migrate-state -backend-config=backend.hcl
```

Lặp lại cho `03-hub-app` và `04-dashboard` nếu local backend metadata vẫn trỏ key cũ. Nếu
Terraform không nhận diện migration, dừng lại và kiểm tra object/state version trước khi dùng
công cụ S3; không chạy `apply` trên một state rỗng.

## Rollback / dừng lab

- Rollback application: pin lại image tag đã biết tốt trong `terraform.tfvars`, rồi `terraform apply`.
- Không rollback bằng cách xóa target group/ALB thủ công.
- Khi dừng lab, destroy theo dependency và giữ `00-bootstrap`/state bucket:
  `04-dashboard` → `03-hub-app` → `02-platform` → `01-foundation`.
- Chỉ destroy `01-foundation` khi chắc chắn không còn workload hoặc state cần giữ.
- Không destroy `00-bootstrap` trước khi export/backup toàn bộ remote state.
