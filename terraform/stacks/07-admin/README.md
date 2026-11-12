# 07-admin — admin console

Triển khai [`web/admin`](../../../web/admin/README.md) tại `admin.<domain>`. Stack ứng dụng: không tạo VPC, EKS, RDS hay ALB mới.

## Phụ thuộc

```text
00-bootstrap → 01-foundation → 02-platform → 03-hub-app → 07-admin
```

Đọc remote state của `02-platform` (VPC, ALB, security group, Cognito, database) và `03-hub-app` (HTTPS listener).
Cần `terraform.tfvars` (không commit) theo `terraform.tfvars.example`.

## Tài nguyên

- IAM role chỉ-đọc cho pod qua IRSA, và policy `Describe*`/`List*`; thêm `ce:GetCostAndUsage` khi `enable_cost_explorer`.
- ACM certificate cho `admin.<domain>` (xác thực DNS trong Route 53), bản ghi alias tới ALB.
- Target group `admintg-<env>` cổng 5000, security group rules giữa ALB và node.
- Namespace `admin`: ServiceAccount, ClusterRole chỉ-đọc, Secret `admin-config`, Deployment 1 replica, Service, TargetGroupBinding.
- Listener rule (priority 110) theo host, tùy chọn giới hạn `admin_allowed_cidrs`.

## Cách apply

1. Publish image `mlbox-admin` (workflow `images.yml`), điền `admin_image` bằng SHA đầy đủ.
2. Tạo `admin_password_hash` bằng `npm run hash-password` trong `web/admin`.
3. Lần đầu để `deploy_admin = false`, apply để tạo IAM, chứng chỉ, DNS và target group.
4. Đặt `deploy_admin = true`, `terraform plan` rồi apply.

```bash
terraform init -backend-config=backend.hcl
terraform plan
terraform apply
```

Quyền của người apply cần thêm: tạo role IAM, ACM, bản ghi Route 53. Cost Explorer phải được bật trong Billing console
trước khi bật `enable_cost_explorer`.
