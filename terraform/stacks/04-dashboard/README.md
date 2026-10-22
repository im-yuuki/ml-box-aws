# 04-dashboard — dashboard application stack

Stack này triển khai dashboard ML Box ở apex domain và chuẩn bị ECR repository cho
BFF. Đây là stack ứng dụng, không tạo VPC, EKS, RDS, Cognito hoặc ALB mới.

## Phụ thuộc

Phải apply theo thứ tự:

```text
00-bootstrap → 01-foundation → 02-platform → 03-hub-app → 04-dashboard
```

Stack đọc remote state của:

- `02-platform`: VPC, ALB, ACM, Cognito và node security group.
- `03-hub-app`: HTTPS listener ARN để thêm host-header rule cho dashboard.

DNS/ACM phải hoàn tất trước khi apply stack này. Xem:

- [`docs/DEPLOYMENT.md`](../../../docs/DEPLOYMENT.md)
- [`docs/OPERATIONS.md`](../../../docs/OPERATIONS.md)
- [`deploy/DNS-CLOUDFLARE.md`](../../../deploy/DNS-CLOUDFLARE.md)

## Tài nguyên

- ECR repositories:
  - `jhub-gpu-sandbox/dashboard`
  - `jhub-gpu-sandbox/bff`
- ALB target group cho dashboard trên port `3000`.
- Security-group rules cho phép ALB truy cập node/pod dashboard trên port `3000`.
- Namespace `dashboard`, Deployment, Service và TargetGroupBinding khi
  `deploy_dashboard = true`.
- Apex listener rule cho `https://mlbox.june8th.me` và certificate apex từ
  `02-platform`.

## Trạng thái hiện tại

Terraform stack đã được apply và Deployment dashboard đang chạy. Tuy nhiên,
production chưa đạt acceptance vì Next.js production trả HTTP 500 với digest
`DYNAMIC_SERVER_USAGE`; dev mode trả 200. Vì vậy không coi dashboard hiện tại là
production-ready cho đến khi sửa runtime, build/push image mới, apply lại stack và
xác nhận ALB target healthy.

BFF ECR repository đã được tạo nhưng source/service BFF thật chưa có trong repo.
Các route `/api/bff/*` hiện là stub hoặc trả `501 BFF_NOT_DEPLOYED`; không được
coi mock data là trạng thái thật của sandbox, quota hoặc account.

## Apply / rollout

```bash
cd terraform/stacks/04-dashboard
terraform init -reconfigure -backend-config=backend.hcl
terraform plan
terraform apply

kubectl -n dashboard rollout status deployment/dashboard
kubectl -n dashboard get pods,svc,targetgroupbinding
```

`dashboard_image` phải là immutable ECR tag dạng `dev-<gitshortsha>` và phải được
push trước khi đặt `deploy_dashboard = true`. Không dùng `latest`.

Sau khi rollout, kiểm tra:

```bash
curl -sS -o /dev/null -w '%{http_code}\n' https://mlbox.june8th.me/
aws elbv2 describe-target-health \
  --target-group-arn "$(terraform output -raw dashboard_target_group_arn)"
kubectl -n dashboard logs deploy/dashboard --tail=100
```

Nếu target unhealthy, đọc reason của ALB trước khi sửa; đặc biệt phân biệt lỗi
kết nối/SG với lỗi HTTP 5xx từ ứng dụng. Runbook chi tiết ở `docs/OPERATIONS.md`.
