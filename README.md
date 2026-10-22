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
    02-platform/    # S3 workspace + RDS + Cognito + ECR + LB controller + ALB/TG + ACM cert
    03-hub-app/     # JupyterHub (Z2JH) + TargetGroupBinding + listener + profile CPU
    04-dashboard/   # Dashboard + BFF + apex listener rule
    99-unverified-gpu/ # optional GPU device plugin + DCGM exporter (chờ quota)
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

## Trạng thái hiện tại

- Hạ tầng `00-bootstrap` → `03-hub-app` đã apply; notebook đang ở
  `https://notebook.mlbox.june8th.me`.
- Theme notebook đã apply và CPU profile đang được dùng; GPU profile chưa bật.
- `04-dashboard` đã apply tại `https://mlbox.june8th.me`, nhưng production runtime
  hiện còn lỗi `DYNAMIC_SERVER_USAGE`; BFF thật và các flow sandbox/auth end-to-end
  chưa hoàn thành.
- `99-unverified-gpu` là stack tùy chọn, chờ GPU quota.

Tài liệu vận hành:

- [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md) — triển khai, DNS/ACM, rollback và state rename.
- [`docs/OPERATIONS.md`](docs/OPERATIONS.md) — health check, log, rollout, incident và chi phí.
- [`TODO.md`](TODO.md) — checklist tính năng/công việc đã và chưa hoàn thành.

## Quy trình deploy (1 region/lần)

```bash
source .private/aws-env.sh        # nạp credentials từ phiên `aws login`

cd terraform/stacks/00-bootstrap
terraform init; terraform apply   # 1 lần/account; tự sinh backend.hcl cho 01/02/03/04 và 99-unverified-gpu

cd ../01-foundation
terraform init -reconfigure -backend-config=backend.hcl
terraform plan; terraform apply   # ~15-20 phút, KHÔNG ngắt giữa chừng

cd ../02-platform
terraform init -reconfigure -backend-config=backend.hcl
terraform plan; terraform apply   # ALB + cert + RDS + Cognito + ECR

# >>> KHOẢNG NGHỈ: delegate DNS zone sang Route53 và chờ ACM ISSUED - xem deploy/DNS-CLOUDFLARE.md

cd ../03-hub-app
terraform init -reconfigure -backend-config=backend.hcl
terraform plan; terraform apply   # tự chờ cert ISSUED rồi tạo listener + hub

cd ../../..                        # quay về repository root
./deploy/apply-hub-theme.sh        # ConfigMap theme (Hub templates + static)

cd terraform/stacks/04-dashboard
terraform init -reconfigure -backend-config=backend.hcl
terraform plan; terraform apply   # dashboard apex + BFF

# CPU-only chạy được ngay sau `04-dashboard` (NodePool `cpu-user` không cần quota GPU).

# Chỉ khi quota GPU đã được cấp:
cd ../99-unverified-gpu
terraform init -reconfigure -backend-config=backend.hcl
terraform plan; terraform apply   # rồi bật profile GPU trong 03-hub-app
```

Profile GPU chỉ bật khi `enable_gpu_profiles = true` và stack `99-unverified-gpu` đã apply.

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
