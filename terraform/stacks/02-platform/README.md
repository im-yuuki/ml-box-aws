# 02-platform: phase 1 của deployment

Stack này tạo toàn bộ hạ tầng **phải có trước** khi operator dừng lại để delegate DNS zone sang Route53 và chờ ACM validation.
Không có JupyterHub ở đây - helm release của hub nằm ở stack `03-hub-app`.

## Stack này tạo gì

| Module | Tài nguyên |
|---|---|
| `storage` | S3 bucket workspace (KMS, versioning, lifecycle) + IAM role cho hub AssumeRole theo prefix `users/<id>/` |
| `hub_db` | RDS Postgres (private subnet, SG chỉ cho EKS node) + master password do RDS quản lý trong Secrets Manager |
| `auth` | Cognito User Pool + hosted UI + OIDC app client (`hub_callback_url` = `https://notebook.<domain>/hub/oauth_callback`) |
| `ecr` | ECR repos `jhub-gpu-sandbox/cpu` và `jhub-gpu-sandbox/gpu` |
| `ingress_dns` | AWS Load Balancer Controller (helm + IRSA), ALB internet-facing ở public subnet, target group, chứng thư ACM cho `notebook.<domain>` |

ALB, target group và chứng thư ACM nằm ở đây nên sau khi apply xong stack này mới có đủ thông tin để trỏ DNS.

## Thứ tự apply

```
00-bootstrap     S3 state + DDB lock
01-foundation    VPC + EKS + Karpenter
02-platform      S3 workspace + RDS + Cognito + ECR + LB controller + ALB/TG + ACM cert
   >>> KHOẢNG NGHỈ: delegate zone sang Route53, đổi nameserver ở Cloudflare, chờ ACM ISSUED <<<
03-hub-app       JupyterHub (Z2JH) + TargetGroupBinding + listener + profile CPU
04-dashboard     Dashboard + BFF + apex listener rule

99-unverified-gpu device plugin + DCGM + L4 shared [TÙY CHỌN - chỉ apply khi có GPU quota]
```

## Operator pause: delegate zone sang Route53

Với `manage_route53 = true`, Terraform tạo zone Route53, ACM DNS validation records
và các A-alias record cho `notebook.<domain>` và `<domain>`. Cloudflare chỉ còn giữ
vai trò đổi nameserver; không tạo CNAME/TXT thủ công trong Cloudflare.

Lấy thông tin cần thiết từ output của `02-platform`:

```bash
terraform -chdir=terraform/stacks/02-platform output alb_dns_name
terraform -chdir=terraform/stacks/02-platform output route53_zone_nameservers
terraform -chdir=terraform/stacks/02-platform output -json certificate_validation_records
terraform -chdir=terraform/stacks/02-platform output certificate_status
terraform -chdir=terraform/stacks/02-platform output apex_certificate_status
```

Thực hiện:

1. Đổi 4 nameserver của zone `mlbox.june8th.me` tại Cloudflare/registrar sang
   `route53_zone_nameservers`.
2. Chờ Route53 authoritative và cả hai ACM certificate chuyển sang `ISSUED`.
3. Chỉ sau đó apply `03-hub-app`; stack này tự poll certificate trước khi tạo HTTPS listener.
4. Xem chi tiết và cảnh báo về các record hiện có tại `deploy/DNS-CLOUDFLARE.md`.

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
