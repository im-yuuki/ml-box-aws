# Region matrix — 1 cluster mỗi region, apply 1 region mỗi lần

Quyết định: mỗi region AWS chạy đúng 1 EKS cluster (`<name>-<env>-<mã region>`,
ví dụ `jhub-gpu-sandbox-dev-apse2`). Mã ngắn để IAM name_prefix (38 ký tự) không vỡ.

## Bảng CIDR/AZ (không trùng nhau để sau này peering/replication chéo region)

| Region | Mã | VPC CIDR | AZ | Trạng thái |
|---|---|---|---|---|
| ap-southeast-2 | apse2 | 10.0.0.0/16 | a, b, c | Triển khai đầu tiên (Sydney) |
| ap-southeast-1 | apse1 | 10.1.0.0/16 | a, b, c | Sau (Singapore) |
| ap-southeast-3 | apse3 | 10.2.0.0/16 | a, b, c | Sau (Jakarta) |

CIDR/AZ tự suy từ `region` qua `region_cidrs`/`region_azs` trong
`stacks/01-foundation/variables.tf`. Chỉ override `vpc_cidr`/`azs` khi có lý do.

## Quy trình apply 1 region

```bash
cd terraform/stacks/01-foundation
# backend.hcl: key = "dev/<region>/01-foundation.tfstate" (riêng mỗi region!)
terraform init -backend-config=backend.hcl
terraform plan -var region=ap-southeast-2
terraform apply -var region=ap-southeast-2
```

Thêm region mới = xin quota GPU ở region đó + lặp lại 3 stack với `-var region=...`.
Không sửa module.

## Checklist trước khi mở region mới

- [ ] Service Quotas họ G (g6/g4dn/g5) ở region mới được duyệt
- [ ] Xác nhận họ GPU cần dùng có sẵn ở region đó (khác nhau giữa các region)
- [ ] Giá NAT/EC2/RDS ở region mới (Sydney/Singapore/Jakarta khác nhau)
- [ ] Domain/Route53 routing (latency hoặc geolocation) trỏ về ALB đúng region
- [ ] ECR: replication chéo region hoặc build image riêng mỗi region
