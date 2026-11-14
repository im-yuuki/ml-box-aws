# MLBox — JupyterHub GPU Sandbox trên AWS EKS (Terraform)

Sandbox notebook theo user, ephemeral, GPU chia sẻ (time-slicing) + dedicated,
1 cluster mỗi region, triển khai bằng Terraform theo stack.

## Quyết định đã chốt

| Nội dung | Giá trị |
|---|---|
| Region đầu tiên | ap-southeast-2 (Sydney), mã ngắn `apse2` |
| Region tiếp theo | ap-southeast-1, ap-southeast-3 (xem `docs/regions.md`) |
| GPU shared | T4 (g4dn), time-slicing replicas 2 @ commit 8GB / ceiling 12GB |
| GPU dedicated | 1 GPU/node (g4dn/g6/g5.xlarge), tạm không MIG |
| NAT | `fck_nat` cho lab (~$5/tháng); `managed_per_az` cho prod |
| K8s | 1.36 (1.33 đã rơi vào extended support) |

## Version đã verify

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
    00-bootstrap/   # S3 state bucket + DynamoDB lock + Route53 zone + ACM (1 lần/account, state local)
    01-foundation/  # network + EKS + Karpenter (VPC dual-stack, MNG system, NodePools)
    02-platform/    # S3 workspace + RDS + Cognito + LB controller + ALB/TG + namespace dashboard
    03-hub-app/     # JupyterHub (Z2JH) + TargetGroupBinding + listener + profile CPU
    04-dashboard/   # Dashboard + BFF + apex listener rule
    05-gpu/         # device plugin NVIDIA + DCGM exporter
    06-storage/     # EFS + EFS CSI driver + StorageClass efs-sc (notebook storage theo Project)
    07-admin/       # Admin console vận hành (IRSA, chỉ-đọc mặc định)
    08-alerting/    # SNS topic, IRSA roles, CloudWatch alarms (ALB, RDS), log group /mlbox
  modules/
    network/ eks/ karpenter/ gpu-stack/ storage/ hub-db/ auth/ ingress-dns/ efs-storage/
images/              # Dockerfile CPU/GPU (theme JupyterLab đóng gói sẵn)
scripts/             # build-images.sh (build/push local; CI images.yml build/push cả 5 image lên GHCR)
web/
  dashboard/         # Dashboard Next.js (frontend)
  bff/               # Backend-for-frontend (Cognito + JupyterHub API)
  admin/             # Console vận hành (Fastify + UI)
  theme/             # nguồn theme MLBox (Hub templates + Lab extension)
deploy/              # apply-hub-theme.sh, DNS-CLOUDFLARE.md
monitoring/          # kube-prometheus-stack values, fluent-bit, alert rules, smoke test (2026-11-14)
docs/
  DEPLOYMENT.md      # runbook triển khai đầy đủ (9 stack) + teardown + checklist account mới
  OPERATIONS.md      # vận hành, health check, log tập trung, monitoring, incident, chi phí
  runbooks/          # runbook feature mới + release acceptance checklist
  regions.md         # bảng CIDR/AZ 3 region SEA + quy trình apply từng region
  aws-resource-map.md # sơ đồ Mermaid các service AWS
```

## Trạng thái hiện tại

- Hạ tầng `00` → `07` đã được **phá toàn bộ và dựng lại từ đầu** ngày 2026-11-13 (giữ `00-bootstrap`:
  zone Route53, chứng thư ACM, bucket state). Việc này kiểm chứng khả năng reproducible của dự án.
- Monitoring/alerting/log tập trung đã triển khai ngày 2026-11-14: kube-prometheus-stack (Prometheus +
  Alertmanager → SNS), `08-alerting` (CloudWatch alarms ALB/RDS, `/mlbox` retention 30d), Fluent Bit.
  Xem [`monitoring/README.md`](monitoring/README.md).
- CI test tích hợp Postgres đã merge (PR #14, `.github/workflows/integration-tests.yml`).
- E2E production đã kiểm chứng (2026-11-14): register → login → project → sandbox → notebook → artifact → quota.
- Image đang chạy (GHCR, pin theo commit SHA): `ghcr.io/im-yuuki/mlbox-{dashboard,bff,admin,cpu,gpu}:61c5083681579b41140fa98abbeed3d0d1155e9c`.
- Database được tạo lại từ đầu: dữ liệu cũ không còn; schema ứng dụng được BFF tạo lần đầu khi có request xác thực, không phải lúc khởi động.
- `05-gpu` đã apply; time-slicing đã kiểm chứng trên g4dn (T4); còn chờ capacity g6/L4.
- `07-admin` là lần apply đầu tiên trên cluster thật; `08-alerting` apply ngày 2026-11-14.
- Các việc còn mở cho release: cost anomaly chưa có (budget $50/tháng trong Console đang ALARM — chi thực ~$217, forecast ~$591 — bạn tự xử lý). Subscription
  SNS `me@june8th.eu.org` đã xác nhận; verify code qua mail đã kiểm chứng lại 2026-11-14 (mail.tm nhận
  mã, confirm → login OK). Secrets rò rỉ 2026-11-14 đã xoay xong (2026-11-14, xem TODO). Backup/restore
  EFS đã kiểm chứng (restore PASS 2026-11-14).

## Quy trình deploy (1 region/lần)

```bash
aws login                                             # SSO, lưu phiên cho CLI + Terraform
export AWS_PROFILE=AdministratorAccess-<account-id>    # Windows: dùng .private/aws-env.cmd
export AWS_REGION=ap-southeast-2

cd terraform/stacks/00-bootstrap
terraform init; terraform apply    # 1 lần/account; tự sinh backend.hcl cho 01–08

cd ../01-foundation
terraform init -reconfigure -backend-config=backend.hcl
terraform plan; terraform apply    # ~15-20 phút, KHÔNG ngắt giữa chừng

cd ../02-platform
terraform init -reconfigure -backend-config=backend.hcl
terraform plan; terraform apply    # ALB + cert + RDS + Cognito + namespace dashboard

cd ../06-storage                    # EFS + StorageClass efs-sc: PHẢI trước 03-hub-app
terraform init -reconfigure -backend-config=backend.hcl
terraform plan; terraform apply

# >>> KHOẢNG NGHỈ: delegate subdomain mlbox sang Route53 và chờ ACM ISSUED - xem deploy/DNS-CLOUDFLARE.md

cd ../03-hub-app
terraform init -reconfigure -backend-config=backend.hcl
terraform plan; terraform apply    # tự chờ cert ISSUED rồi tạo listener + hub

cd ../../..                         # quay về repository root
./deploy/apply-hub-theme.sh        # ConfigMap theme (Hub templates + static)

cd terraform/stacks/04-dashboard
terraform init -reconfigure -backend-config=backend.hcl
terraform plan; terraform apply    # dashboard apex + BFF

# Tuỳ chọn: GPU (cần quota) và admin console
cd ../05-gpu && terraform init -reconfigure -backend-config=backend.hcl && terraform plan && terraform apply
cd ../07-admin && terraform init -reconfigure -backend-config=backend.hcl && terraform plan && terraform apply

# Tuỳ chọn: alerting (SNS, alarms) — xem monitoring/README.md trước khi apply
cd ../08-alerting && terraform init -reconfigure -backend-config=backend.hcl && terraform plan && terraform apply
```

Profile GPU chỉ bật khi `enable_gpu_profiles = true` và stack `05-gpu` đã apply.

Verify: `aws eks update-kubeconfig --name jhub-gpu-sandbox-dev-apse2 --region ap-southeast-2`,
rồi `kubectl get nodes/nodepools/ec2nodeclasses`.

Chi tiết từng bước, teardown và checklist cho account mới: [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md).

## Chi phí lab (Sydney, ước lượng)

EKS $73/tháng + fck-nat ~$5 + 2× m6i.large + EBS, cộng monitoring (CloudWatch metrics/logs/SNS gần như không đáng kể, log `/mlbox` 30d không tính theo dung lượng thấp). Tuần không lab thì destroy
stack 01 (ngược thứ tự 08-alerting → 07 → 05 → 04 → 03 → 06 → 02 → 01), cần thì apply lại ~20 phút.

## Sự cố đã gặp (đừng lặp lại)

- Ngắt `apply` giữa chừng → lock kẹt (`force-unlock`) + nodegroup mồ côi (xóa tay bằng CLI).
- Key addon EBS CSI phải là `aws-ebs-csi-driver`, không phải `ebs-csi`.
- Tên cluster dùng mã region ngắn (`apse2`) vì IAM `name_prefix` giới hạn 38 ký tự.
- Destroy báo lỗi data source addon → `destroy -refresh=false`.
- Bucket state bật versioning: xóa bucket phải xả versions trước.
- RDS có `deletion_protection` → phải tắt trước khi destroy (`dashboard_usage_deletion_protection`).
- `03-hub-app` phải apply sau `06-storage` (StorageClass `efs-sc`).
