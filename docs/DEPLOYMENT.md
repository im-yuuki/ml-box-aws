# ML Box — Deployment Runbook

Tài liệu này là quy trình triển khai hiện tại cho một region. Quy trình mặc định được viết cho
`ap-southeast-2` và account `451058046864`; thay các giá trị này nếu triển khai region khác.

## Trạng thái hiện tại

| Thành phần | Trạng thái | Ghi chú |
|---|---|---|
| `00-bootstrap` | ✅ Đã apply | S3 Terraform state + DynamoDB lock |
| `01-foundation` | ✅ Đã apply | VPC, EKS, system node group, Karpenter, CPU NodePool |
| `02-platform` | ✅ Đã apply | RDS, Cognito, ECR, ALB, ACM, Load Balancer Controller |
| DNS / ACM | ✅ Đã cấu hình | Route53 authoritative cho `mlbox.june8th.me`; cert đã `ISSUED` |
| `03-hub-app` | ✅ Đã apply | JupyterHub tại `notebook.mlbox.june8th.me` |
| Hub theme | ✅ Đã apply | ConfigMap theme ML Box |
| `04-dashboard` | ⚠️ Đã apply, cần sửa production runtime | Dashboard target đã nối vào ALB; app production hiện trả HTTP 500 do `DYNAMIC_SERVER_USAGE` |
| `99-unverified-gpu` | ⏸ Chưa apply | Chờ AWS cấp GPU quota |
| BFF thật | ❌ Chưa triển khai | Dashboard hiện chỉ có route stub trả `501` |

## Thứ tự stack bắt buộc

```text
00-bootstrap → 01-foundation → 02-platform → DNS/ACM pause
             → 03-hub-app → apply hub theme → 04-dashboard
```

`99-unverified-gpu` nằm ngoài luồng bắt buộc. Chỉ apply sau khi quota GPU được cấp và đã
kiểm tra image/plugin GPU.

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

- AWS CLI, Terraform `>= 1.6`, `kubectl`, Helm provider credentials và Docker Buildx.
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
- `99-unverified-gpu`

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

Stack tạo ALB, target group, ACM, Cognito, ECR, RDS, workspace S3 và Load Balancer Controller.

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

Trước khi apply, push CPU image vào ECR và cập nhật `terraform.tfvars` nếu tag thay đổi.

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

Image dashboard phải được build với context repository root và push vào ECR trước khi bật
`deploy_dashboard`.

```bash
# Từ repository root
./scripts/build-dashboard.sh

cd terraform/stacks/04-dashboard
terraform init -reconfigure -backend-config=backend.hcl
terraform plan
terraform apply
```

Các build args quan trọng:

```text
NEXT_PUBLIC_COGNITO_REGION=ap-southeast-2
NEXT_PUBLIC_COGNITO_USER_POOL_ID=<pool-id>
NEXT_PUBLIC_COGNITO_CLIENT_ID=<dashboard-client-id>
NEXT_PUBLIC_BFF_BASE_URL=https://mlbox.june8th.me/api/bff
```

Kiểm tra Kubernetes và ALB:

```bash
kubectl -n dashboard get pods,svc,targetgroupbinding
kubectl -n dashboard rollout status deployment/dashboard --timeout=300s
aws elbv2 describe-target-health \
  --target-group-arn "$(terraform -chdir=terraform/stacks/04-dashboard output -raw dashboard_target_group_arn)"
curl -i https://mlbox.june8th.me/
```

### Known blocker hiện tại

Target group đã reach được pod, nhưng production dashboard hiện trả HTTP `500` với digest
`DYNAMIC_SERVER_USAGE`. Nguyên nhân đã khoanh vùng là cookie locale của `next-intl` kết hợp
với `cacheComponents`/`partialPrefetching` trong Next.js production. Dev server trả `200`.

Không đánh dấu dashboard là hoàn tất end-to-end cho đến khi:

- `/` và `/login` trả `200` trong production;
- login/register gọi Cognito thật;
- BFF xác thực JWT và proxy được Hub API;
- sandbox list/spawn/stop chạy với user thật.

## GPU (optional)

Chỉ chạy sau khi AWS cấp quota cho instance GPU và đã xác nhận image GPU:

```bash
cd terraform/stacks/99-unverified-gpu
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
02-gpu       → 99-unverified-gpu
```

Việc đổi tên thư mục cũng đổi backend key. State cũ có thể vẫn nằm ở các key:

```text
03-platform.tfstate → 02-platform.tfstate
04-hub-app.tfstate  → 03-hub-app.tfstate
05-dashboard.tfstate → 04-dashboard.tfstate
```

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
