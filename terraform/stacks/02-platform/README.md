# 02-platform: ALB, platform services và Route53 aliases

Stack này tạo hạ tầng platform sau `01-foundation`. Persistent DNS/ACM đã được tách
sang `00-bootstrap`; operator delegate subdomain `mlbox` từ parent Cloudflare zone
sang Route53 trước khi apply stack này. Có thể apply platform khi ACM còn pending;
phải chờ chứng thư `ISSUED` trước khi apply `03-hub-app`.
Không có JupyterHub ở đây - Helm release của hub nằm ở stack `03-hub-app`.

## Stack này tạo gì

| Module | Tài nguyên |
|---|---|
| `storage` | S3 bucket workspace (KMS, versioning, lifecycle) + IAM role cho hub AssumeRole theo prefix `users/<id>/` |
| `hub_db` | RDS Postgres (private subnet, SG chỉ cho EKS node) + master password do RDS quản lý trong Secrets Manager |
| `auth` | Cognito User Pool + hosted UI + OIDC app client (`hub_callback_url` = `https://notebook.<domain>/hub/oauth_callback`) |
| `ecr` | ECR repos `jhub-gpu-sandbox/cpu` và `jhub-gpu-sandbox/gpu` |
| `ingress_dns` | AWS Load Balancer Controller (Helm + IRSA), ALB internet-facing ở public subnet, target group và A-alias records trong zone do `00-bootstrap` sở hữu |
| GitHub Actions | GitHub OIDC provider, publisher role giới hạn ở 4 ECR repos, production deployer role và RBAC chỉ cho hai dashboard Deployments |

ALB và target group nằm ở đây; Route53 zone và ACM certificates được giữ riêng trong
`00-bootstrap` để việc destroy/redeploy platform không làm mất biên DNS/TLS lâu dài.

## Thứ tự apply

```
00-bootstrap     S3 state + DDB lock
01-foundation    VPC + EKS + Karpenter
02-platform      S3 workspace + RDS + Cognito + ECR + LB controller + ALB/TG + Route53 aliases
   (zone + ACM do 00-bootstrap tạo; delegate NS và chờ ACM ISSUED trước bước này)
03-hub-app       JupyterHub (Z2JH) + TargetGroupBinding + listener + profile CPU
04-dashboard     Dashboard + BFF + apex listener rule

99-unverified-gpu device plugin + DCGM + L4 shared [TÙY CHỌN - chỉ apply khi có GPU quota]
```

## GitHub Actions OIDC

`github_publisher_role_arn` dùng cho repository variable `AWS_ECR_PUBLISH_ROLE_ARN`;
`github_deployer_role_arn` và `github_actions_cluster_name` dùng làm production
environment variables `AWS_DEPLOY_ROLE_ARN` và `EKS_CLUSTER_NAME`. Outputs:

```bash
terraform -chdir=terraform/stacks/02-platform output -raw github_publisher_role_arn
terraform -chdir=terraform/stacks/02-platform output -raw github_deployer_role_arn
terraform -chdir=terraform/stacks/02-platform output -raw github_actions_cluster_name
```

Publisher trust is exactly `repo:im-yuuki/ml-box-aws:ref:refs/heads/master`;
deployer trust is exactly `repo:im-yuuki/ml-box-aws:environment:production`; both
require audience `sts.amazonaws.com`. The deployer IAM policy grants only
`eks:DescribeCluster`. EKS authorization uses a `STANDARD` access entry and a
namespace `dashboard` Role limited to `get`, `patch`, and `watch` on Deployments
named `dashboard` and `bff` (no EKS access policy association).

The foundation EKS module enables IRSA and declares an EKS access entry for the
Karpenter node role, so access-entry authentication is part of the existing
architecture; this change does not alter the cluster authentication mode. If the
GitHub OIDC provider already exists in the account, import its provider ARN into
`aws_iam_openid_connect_provider.github_actions` before the first apply rather
than trying to create a duplicate. Terraform provider credentials must already
have Kubernetes permission to manage the Role and RoleBinding in `dashboard`.

## DNS boundary: delegate zone sang Route53

Với `manage_route53 = true`, Terraform chỉ tạo A-alias record cho
`notebook.<domain>` và `<domain>` trong zone đã được `00-bootstrap` tạo. Zone,
ACM certificates và validation CNAME không thuộc state của platform.

Lấy thông tin cần thiết từ output của `00-bootstrap`:

```bash
terraform -chdir=terraform/stacks/00-bootstrap output route53_zone_id
terraform -chdir=terraform/stacks/00-bootstrap output route53_zone_nameservers
terraform -chdir=terraform/stacks/00-bootstrap output notebook_certificate_status
terraform -chdir=terraform/stacks/00-bootstrap output dashboard_certificate_status
```

Thực hiện:

1. Đổi nameserver của subdomain `mlbox` tại parent Cloudflare zone sang
   `route53_zone_nameservers` từ `00-bootstrap`.
2. Apply `02-platform` để tạo ALB và A-alias records.
3. Chờ Route53 authoritative và cả hai ACM certificate chuyển sang `ISSUED`.
4. Apply `03-hub-app`.
4. Xem chi tiết tại `deploy/DNS-CLOUDFLARE.md`; không tạo CNAME/TXT validation thủ công
   trong Cloudflare.

> Không apply stack sau với backend rỗng hoặc state sai key. Nếu đổi tên stack,
> hãy kiểm tra/migrate state S3 trước; không tự động migrate trong README này.

## Outputs mà `03-hub-app` dùng

| Output | Dùng cho |
|---|---|
| `db_url` (sensitive) | `hub.db.url` trong Z2JH values |
| `cognito_issuer`, `cognito_client_id`, `cognito_client_secret` (sensitive), `cognito_authorize_url`, `cognito_token_url`, `cognito_userdata_url` | `GenericOAuthenticator` |
| `hub_role_arn` | IRSA annotation cho hub service account |
| `ecr_cpu_repo_url`, `ecr_gpu_repo_url` | URL repo để build/push image |
| `alb_arn`, `alb_dns_name`, `alb_security_group_id` | Thông tin ALB (DNS cho operator) |
| `target_group_arn`, `target_group_name` | TargetGroupBinding trong `03-hub-app` |
| `certificate_arn`, `certificate_status`, `certificate_validation_records`, `route53_zone_nameservers` | ACM cert, validation status và nameserver Route53 cho operator |
| `lb_controller_role_arn` | Role của LB controller |
| `vpc_id`, `node_security_group_id`, `private_subnet_ids`, `public_subnet_ids`, `cluster_name` | Thông tin infra đã auto-discover, tiện cho stack sau |

## Ghi chú

- `backend.hcl` do `00-bootstrap` sinh ra tự động (xem `backend.hcl.example` cho shape tham khảo).
- Không có secret nào nằm trong `.tf` hay `terraform.tfvars`; master password của RDS đọc từ Secrets Manager lúc apply.
- Toàn bộ ID của `01-foundation` được auto-discover qua data source (subnet tags, `karpenter.sh/discovery`, OIDC issuer) - không copy thủ công.
