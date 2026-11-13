# 07-admin — admin console

Triển khai [`web/admin`](../../../web/admin/README.md) tại `admin.<domain>`. Stack ứng dụng: không tạo VPC, EKS, RDS hay ALB mới.

## Phụ thuộc

```text
00-bootstrap → 01-foundation → 02-platform → 03-hub-app → 07-admin
```

Cần `terraform.tfvars` (không commit) theo `terraform.tfvars.example`. `state_bucket` là biến bắt buộc:
điền tên bucket state mà `00-bootstrap` tạo (`jhub-gpu-sandbox-tfstate-<account-id>`), cùng bucket mà
`backend.hcl` của stack này trỏ tới. `state_key` và `state_key_hub_app` để trống thì suy ra từ
`env`/`region`.

Đọc remote state của `02-platform` (VPC, ALB, security group, Cognito, database) và `03-hub-app` (HTTPS listener).

## Tài nguyên

- IAM role cho pod qua IRSA: policy `Describe*`/`List*`, Service Quotas và `AdminGetUser` (chỉ-đọc). Thêm `ce:GetCostAndUsage` khi
  `enable_cost_explorer`; thêm `AdminDisableUser`/`AdminEnableUser`/`AdminUserGlobalSignOut` (chỉ user pool của sản phẩm) khi `enable_actions`.
- ACM certificate cho `admin.<domain>` (xác thực DNS trong Route 53), bản ghi alias tới ALB.
- Target group `admintg-<env>` cổng 5000, security group rules giữa ALB và node.
- Namespace `admin`: ServiceAccount, ClusterRole chỉ-đọc (gồm NodePool và NodeClaim của Karpenter), Secret `admin-config`, Deployment 1 replica,
  Service, TargetGroupBinding. Token của Hub chỉ vào Secret khi `enable_actions`.
- Listener rule (priority 110) theo host, tùy chọn giới hạn `admin_allowed_cidrs`.

## Cách apply

1. Publish image `mlbox-admin` (workflow `images.yml`), điền `admin_image` bằng SHA đầy đủ.
2. Tạo `admin_password_hash` bằng `npm run hash-password` trong `web/admin`.
3. Lần đầu để `deploy_admin = false`, apply để tạo IAM, chứng thư, DNS và target group.
4. Đặt `deploy_admin = true`, `terraform plan` rồi apply.

```bash
terraform init -reconfigure -backend-config=backend.hcl
terraform plan
terraform apply
```

`enable_actions` mặc định tắt. Bật nó là quyết định riêng: console khi đó có thể dừng notebook, khóa tài khoản và đổi gói.

Quyền của người apply cần thêm: tạo role IAM, ACM, bản ghi Route 53. Cost Explorer phải được bật trong Billing console
trước khi bật `enable_cost_explorer`.

Kiểm tra sau khi apply:

```bash
kubectl -n admin get pods,svc,targetgroupbinding
kubectl -n admin rollout status deployment/admin-console --timeout=300s
curl -sS -o /dev/null -w '%{http_code}\n' https://admin.<domain>/healthz
```
