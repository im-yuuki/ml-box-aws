# JupyterHub GPU Sandbox trên AWS EKS (Terraform)

Sandbox notebook theo user, ephemeral, GPU chia sẻ (time-slicing) + dedicated,
1 cluster mỗi region, triển khai bằng Terraform theo stack.

## Quyết định đã chốt

| Nội dung | Giá trị |
|---|---|
| Region đầu tiên | ap-southeast-2 (Sydney), mã ngắn `apse2` |
| Region tiếp theo | ap-southeast-1, ap-southeast-3 (xem `docs/regions.md`) |
| GPU shared | L4 (g6), time-slicing replicas 3 @ commit 8GB / ceiling 12GB |
| GPU dedicated | 1 GPU/node (g4dn/g6/g5.xlarge), tạm không MIG |
| NAT | `fck_nat` cho lab (~$5/tháng); `managed_per_az` cho prod |
| K8s | 1.36 (1.33 đã rơi vào extended support) |

## Version đã verify (2026-10-12)

| Thành phần | Version |
|---|---|
| Karpenter chart/app | v1.15.0 |
| nvidia-device-plugin chart | 0.20.1 |
| dcgm-exporter chart | 4.8.4 |
| Z2JH chart | 4.4.2 |
| fck-nat module | 1.3.0 (bản cuối hỗ trợ AWS provider 5.x) |
| terraform-aws-modules/vpc | ~> 5.8 (đã dùng 5.21.0) |
| terraform-aws-modules/eks | ~> 20.8 (đã dùng 20.37.2) |

## Cấu trúc

```text
terraform/
  stacks/
    00-bootstrap/   # S3 state bucket + DynamoDB lock (1 lần/account, state local)
    01-foundation/  # network + EKS + Karpenter (VPC dual-stack, MNG system, NodePools)
    02-gpu/         # device plugin time-slicing + DCGM exporter (PHASE 2 - cần quota GPU)
    03-platform/    # S3 workspace + RDS + Cognito + ECR + LB controller + ALB/TG + ACM cert
    04-hub-app/     # JupyterHub (Z2JH) + TargetGroupBinding + listener + profile CPU
  modules/
    network/ eks/ karpenter/ gpu-stack/
    storage/ hub-db/ auth/ ecr/ ingress-dns/
images/              # Dockerfile CPU/GPU + script build/push lên ECR
scripts/             # build-images.sh (đóng gói theme JupyterLab vào image)
web/theme/           # nguồn theme ML Box (Hub templates + Lab extension)
deploy/              # apply-hub-theme.sh, DNS-CLOUDFLARE.md
docs/
  regions.md          # bảng CIDR/AZ 3 region SEA + quy trình apply từng region
  aws-resource-map.md # sơ đồ Mermaid các service AWS
  aws-resource-map.png# sơ đồ kèm logo AWS
```

## Quy trình deploy (1 region/lần)

```bash
source .private/aws-env.sh        # nạp credentials từ phiên `aws login`

cd terraform/stacks/00-bootstrap
terraform init; terraform apply   # 1 lần/account; tự sinh backend.hcl cho 01/02/03/04

cd ../01-foundation
terraform init -reconfigure -backend-config=backend.hcl
terraform plan; terraform apply   # ~15-20 phút, KHÔNG ngắt giữa chừng

cd ../03-platform
terraform init -reconfigure -backend-config=backend.hcl
terraform plan; terraform apply   # ALB + cert + RDS + Cognito + ECR

# >>> KHOẢNG NGHỈ: thêm DNS ở Cloudflare (CNAME + TXT ACM) - xem deploy/DNS-CLOUDFLARE.md

cd ../04-hub-app
terraform init -reconfigure -backend-config=backend.hcl
terraform plan; terraform apply   # tự chờ cert ISSUED rồi tạo listener + hub

deploy/apply-hub-theme.sh         # ConfigMap theme (Hub templates + static)

# khi quota GPU về:
cd ../02-gpu
terraform init -reconfigure -backend-config=backend.hcl
terraform plan; terraform apply   # rồi bật profile GPU trong 04-hub-app
```

CPU-only chạy được ngay sau `04-hub-app` (NodePool `cpu-user` không cần quota GPU);
profile GPU chỉ bật khi `enable_gpu_profiles = true` và stack `02-gpu` đã apply.

Verify: `aws eks update-kubeconfig --name jhub-gpu-sandbox-dev-apse2 --region ap-southeast-2`,
rồi `kubectl get nodes/nodepools/ec2nodeclasses`.

## Chi phí lab (Sydney, ước lượng)

EKS $73/tháng + fck-nat ~$5 + 2× m6i.large + EBS. Tuần không lab thì destroy
stack 01 (ngược thứ tự 02 → 01 → 00), cần thì apply lại ~20 phút.

## Sự cố đã gặp (đừng lặp lại)

- Ngắt `apply` giữa chừng → lock kẹt (`force-unlock`) + nodegroup mồ côi (xóa tay bằng CLI).
- Key addon EBS CSI phải là `aws-ebs-csi-driver`, không phải `ebs-csi`.
- Tên cluster dùng mã region ngắn (`apse2`) vì IAM `name_prefix` giới hạn 38 ký tự.
- Destroy báo lỗi data source addon → `destroy -refresh=false`.
- Bucket state bật versioning: xóa bucket phải xả versions trước.
