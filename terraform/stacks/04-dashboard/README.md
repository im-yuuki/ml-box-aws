# 04-dashboard — dashboard application stack

Stack này triển khai dashboard ML Box tại apex domain và BFF nội bộ để xử lý
Cognito session và JupyterHub API. Đây là stack ứng dụng, không tạo VPC, EKS,
RDS, Cognito hoặc ALB mới.

## Phụ thuộc

Phải apply theo thứ tự:

```text
00-bootstrap → 01-foundation → 02-platform → 03-hub-app → 04-dashboard
```

DNS/ACM phải hoàn tất trước khi apply stack này. Stack đọc remote state của:

- `02-platform`: VPC, ALB, Route53 aliases, Cognito và node security group; ACM certificates đến từ `00-bootstrap`.
- `03-hub-app`: HTTPS listener ARN và BFF service token của JupyterHub.

Xem thêm [`docs/DEPLOYMENT.md`](../../../docs/DEPLOYMENT.md) và
[`docs/OPERATIONS.md`](../../../docs/OPERATIONS.md).

## Tài nguyên

- ECR repositories immutable, scan-on-push:
  - `jhub-gpu-sandbox/dashboard`
  - `jhub-gpu-sandbox/bff`
- ALB target group cho dashboard trên port `3000` và security-group rules tương ứng.
- Namespace `dashboard` với:
  - Deployment/Service `dashboard`;
  - Deployment/Service `bff` trên port `4000`;
  - Kubernetes Secret `bff-config` chứa session secret và Hub API token;
  - TargetGroupBinding cho dashboard.
- Apex listener rule cho `https://mlbox.june8th.me` và certificate apex từ
  `02-platform`.

BFF chỉ nhận request từ Next.js qua `BFF_INTERNAL_URL`; Hub API token không được
đưa vào image hoặc trình duyệt. BFF session dùng cookie HttpOnly được mã hóa bằng
secret sinh trong state của stack này. Do đó state backend S3 phải bật encryption,
versioning và lock; không đưa `terraform.tfvars`, backend hoặc state vào Git.

## Trạng thái hiện tại

Luồng `00-bootstrap` → `04-dashboard` đã được fresh deploy từ state/backend mới.
Dashboard và BFF đang Running; TargetGroupBinding đã reconcile và dashboard ALB
target đang healthy. Hai image immutable `dev-16de76b` đã được push vào ECR và
được dùng trong rollout.

Production dashboard đã xử lý `DYNAMIC_SERVER_USAGE` bằng cách bỏ
`cacheComponents`/`partialPrefetching`; kiểm tra qua ALB cho thấy `/` và `/login`
trả `200`. BFF readiness nội bộ `/v1/health` trả `200`; các API yêu cầu đăng nhập
trả `401` khi chưa có session. Acceptance authenticated Cognito/JupyterHub và
sandbox lifecycle vẫn cần test user thật.

## Build images

Từ repository root, sau khi `02-platform` tạo ECR và Cognito:

```bash
source .private/aws-env.sh
export NEXT_PUBLIC_COGNITO_USER_POOL_ID="$(terraform -chdir=terraform/stacks/02-platform output -raw cognito_user_pool_id)"
export NEXT_PUBLIC_COGNITO_CLIENT_ID="$(terraform -chdir=terraform/stacks/02-platform output -raw cognito_dashboard_client_id)"
PUSH=1 ./scripts/build-dashboard.sh
```

Script tạo cùng một immutable tag `dev-<gitshortsha>` cho dashboard và BFF. BFF
không nhận secret lúc build; secret chỉ được inject lúc chạy bởi Terraform.

## Apply / rollout

```bash
cd terraform/stacks/04-dashboard
terraform init -reconfigure -backend-config=backend.hcl
terraform plan
terraform apply

kubectl -n dashboard rollout status deployment/dashboard --timeout=300s
kubectl -n dashboard rollout status deployment/bff --timeout=300s
kubectl -n dashboard get pods,svc,targetgroupbinding
```

`dashboard_image` và `bff_image` phải là immutable ECR tags, không dùng `latest`.

Sau rollout:

```bash
curl -sS -o /dev/null -w '%{http_code}\n' https://mlbox.june8th.me/
curl -sS -o /dev/null -w '%{http_code}\n' https://mlbox.june8th.me/login
kubectl -n dashboard logs deploy/bff --tail=100
aws elbv2 describe-target-health \
  --target-group-arn "$(terraform output -raw dashboard_target_group_arn)"
```

BFF readiness/liveness dùng `/v1/health`. Nếu thiếu env/Secret, endpoint trả
503 và pod không Ready. Nếu target ALB unhealthy, phân biệt lỗi kết nối/SG với
HTTP 5xx của dashboard theo runbook vận hành.
