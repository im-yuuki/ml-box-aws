# AWS Cost Report — JupyterHub GPU Sandbox, 1 region

> Báo cáo chi phí cho quy mô deploy 1 region (mặc định `ap-southeast-2` Sydney,
> mã ngắn `apse2`, xem `docs/regions.md` và `terraform/stacks/01-foundation/variables.tf`).
> Giá tham khảo có 2 cột: `us-east-1` (baseline rẻ nhất) và `ap-southeast-2` (region deploy).
> Giá EC2 on-demand hai cột đã verify ngày 2026-10-23 (nguồn cloud-credits.org/instances,
> aws-pricing.com, daestro); các mục khác lấy theo tài liệu repo (`docs/aws-resource-map.md`)
> và hệ số quy đổi ~+25-30% khi chưa verify — đánh dấu bằng `(≈)`, cần đối chiếu bill thật.

## 1. Giá dịch vụ tham khảo (us-east-1 vs ap-southeast-2)

| Dịch vụ | us-east-1 | ap-southeast-2 | Mục đích dùng trong stack | Ghi chú |
|---|---|---|---|---|
| EKS control plane | $0.10/giờ = **$73/th** | $0.10/giờ = **$73/th** | control plane K8s (API server, etcd, scheduler) — bắt buộc của cluster | phẳng theo region |
| m6i.large (system node) | $0.096/giờ | **$0.12/giờ** | node chạy services hệ thống: hub, proxy, karpenter, LB controller, coredns, dashboard/BFF | OD, Linux; sau tối ưu đổi t4g.large |
| g6.xlarge (1× L4) | $0.8048/giờ | **$1.05/giờ** (+30%) | node notebook GPU shared (1 L4 time-slicing ~3 phiên) | OD; spot us-east-1 ~$0.62, Sydney ~$0.71 |
| g6.2xlarge / 4xlarge | ≈ 2× / 4× giá xlarge | ≈ 2× / 4× giá xlarge | tùy chọn node shared L4 nhiều RAM hơn cho phiên GPU nặng | ≈, chưa verify từng size |
| g4dn.xlarge (1× T4) | $0.526/giờ | **$0.684/giờ** (+30%) | node GPU T4 dedicated — dòng GPU rẻ nhất cho profile dedicated | OD; spot us-east-1 ~$0.32, Sydney ~$0.29 |
| g5.xlarge (1× A10G) | $1.01/giờ | **~$1.31/giờ** (≈ +30%) | node GPU A10G dedicated — mạnh hơn T4 cho session nặng | đúng cho profile dedicated |
| Spot (m/c/r) | ~60-70% OD | ~60-70% OD (≈) | giảm giá phiên notebook CPU (gián đoạn chấp nhận được cho phiên CPU) | chỉ pool `cpu-user` dùng Spot |
| EBS gp3 | $0.08/GB-th | **~$0.104/GB-th (≈)** | root volume node + đĩa workspace đính kèm phiên | mỗi node user root 100Gi |
| RDS gp3 storage | $0.08/GB-th (≈) | ~$0.115/GB-th (≈) | đĩa hub DB (user, token, spawn state) | hub DB 20GB |
| NAT Gateway (managed) | $0.045/giờ = $32.4/th + $0.045/GB | **~$43/th + ~$0.06/GB** | outbound IPv4 (pip, apt, pull image) từ subnet private | prod: 1 NAT/AZ |
| ALB | $16.4/th + $0.008/LCU-giờ | **~$25/th + LCU (≈)** | cổng HTTPS user: publish hub + dashboard, cert ACM | 1 ALB cố định |
| RDS db.t4g.micro (Single-AZ) | ~$0.018/giờ ≈ $13.4/th | **~$20/th (≈)** | DB đăng nhập/trạng thái hub (JupyterHub DB, Postgres) | + 20GB gp3 |
| VPC Endpoint interface | ~$7.3/AZ/endpoint | **~$10/AZ/endpoint (≈)** | đường riêng tới dịch vụ AWS từ subnet private, tránh phí data NAT | 5 endpoint × 3 AZ khi bật ở prod |
| fck-nat (t4g.nano) | $0.0042/giờ ≈ $3/th | **~$4/th** | NAT tự quản thay NAT gw: outbound IPv4 rẻ cho lab | chỉ IPv4 outbound, + phí data qua NAT |
| S3 Standard workspace | $0.023/GB-th | **$0.025/GB-th** | workspace user (backup/sync) + TF state stack 00 | versioning + request rẻ |
| ECR storage | $0.10/GB-th | **$0.10/GB-th (≈)** | lưu image CPU/GPU dùng khi spawn phiên | 2 repo (CPU + GPU ~5-10GB) |
| Secrets Manager (secret RDS) | $0.40/secret-th | $0.40/secret-th | chứa master password RDS (hub DB) | phẳng |
| KMS customer key | $1/key-th | $1/key-th | mã hoá EBS tùy chọn | phẳng; default `alias/aws/ebs` thì $0 |
| Route53 (zone) | $0.50/zone-th | $0.50/zone-th | DNS zone (tùy chọn khi DNS đã trả về Cloudflare) | phẳng + query |
| Cognito User Pool | 0 tới 50k MAU (Lite) | như trái | SSO đăng nhập hub + dashboard | phẳng theo lane |
| SQS interruption queue | 0 (first 1M req free) | như trái | queue nhận sự kiện Spot reclaim/interruption báo về cho Karpenter | Karpenter interruption |

## 2. Chi phí cố định (không thay đổi theo số user)

Cấu hình từ stacks `01-foundation` → `04-dashboard`: VPC dual-stack 3 AZ,
EKS 1.36 + 4 addon, MNG system 2 × m6i.large (min=desired=2, max=4), ALB + 2 TargetGroup,
RDS hub, Secrets, S3 workspace, ECR, Cognito, SQS interruption.

| Khoản | us-east-1/th | ap-southeast-2/th |
|---|---|---|
| EKS control plane | $73 | $73 |
| MNG system 2 × m6i.large | $140 | $175 |
| EBS node system (~50GB × 2) | ~$8 | ~$10 (≈) |
| NAT: lab `fck_nat` ×1 | ~$3 + data | ~$4 + data (≈) |
| NAT: prod `managed_per_az` ×3 | $97 + data | **$129** + data |
| ALB | $16.4 + LCU | ~$25 + LCU (≈) |
| RDS db.t4g.micro + 20GB gp3 | ~$15 | ~$20 (≈) |
| VPC Endpoints interface (chỉ prod: 5 × 3 AZ) | $110 | ~$147 (≈) |
| S3 + ECR + Secrets + KMS + Route53 + SQS/CW ~ | ~$4 | ~$5 |
| **Tổng idle khi 0 user — lab** | **≈ $260** | **≈ $320** |
| **Tổng idle khi 0 user — prod** | **≈ $460** | **≈ $570** |

> Sau tối ưu (kế hoạch `docs/cost-optimization-plan.md`, chưa apply):
> lab ≈ **$180/th**, prod ≈ **$452/th** (Sydney) — system MNG 1 × t4g.large.

Ghi chú:
- Lab `fck_nat` là cấu hình mặc định dev (`nat_mode`); prod bật managed NAT per-AZ + interface endpoints.
- Stack `00-bootstrap` (S3 state + DynamoDB lock) là 1 lần per-account, ~$1-2/th, không cộng thêm theo region.
- Per-AZ AZ count = 3 (`region_azs`), mọi con số nhân theo 3 AZ.

## 3. Autoscale (Karpenter) — 3 NodePool, min = 0

Floor thật của cluster chỉ là 2 node MNG system (mục 2). Ba NodePool đều scale về 0 khi vắng phiên:

| NodePool | Capacity type | Min | Max (`limits`) | Giá node Sydney/th (OD) |
|---|---|---|---|---|
| `cpu-user` | Spot + OD | **0** | 500 vCPU / 2000Gi | m6i.large $87.6; Spot ~$26-44 (≈) |
| `gpu-shared-l4` | OD | **0** | 50 GPU time-slice ≈ ~17 node | g6.xlarge $766 |
| `gpu-dedicated` | OD, `WhenEmpty` | **0** | 20 GPU = 20 node | g4dn $499; g6 $766; g5 ~$960 (≈) |

Mỗi node user root EBS 100Gi gp3 = ~$10.4/th (Sydney ≈) tính theo giờ node chạy.

## 4. Tỉ lệ user/instance kỳ vọng

Bundle người dùng (`hub-values.yaml.tpl`): CPU profile guarantee 0.5 vCPU / 1GB;
GPU shared 3 phiên/GPU (time-slicing, commit 8GB / ceiling 12GB);
GPU dedicated 1 GPU/node không chia.

| Gói | Tỉ lệ kỳ vọng | Chi phí giờ-phiên (Sydney) |
|---|---|---|
| CPU | ~1.5 user/vCPU ⇒ **3-4 user/m6i.large**, ~14 user/m6i.2xlarge | Spot: ~$0.015-0.03/giờ (≈) |
| GPU shared | **3 user/node** (1 GPU × 3 replica) | g6.xlarge $1.05/3 = **$0.35/giờ** |
| GPU dedicated | **1 user/node** | g4dn $0.68; g6 $1.05; g5 ~$1.31/giờ |

Quy mô mục tiêu (handoff doc): 50 user đầu, kiến trúc tới 2000 user đồng thời.

| Kịch bản | Node cần | Chi phí phần autoscale (Sydney/th) |
|---|---|---|
| 0 user | 0 | $0 |
| 50 user (~40 CPU + ~10 shared) | ~4-6 node m/r Spot + ~3-4 g6.xlarge | ~$250-350 (≈) |
| 2000 concurrent (~1600 CPU + ~400 shared) | ~430 node Spot + ~134 node g6 | **chạm cap 50 GPU** ⇒ tăng `limits` hoặc thêm pool T4/A10G |

## 5. Chi phí theo phiên (đối chiếu đơn giá)

- Chi phí hạ tầng cố định Sydney idle ≈ $320/th ⇒ ~$0.44/giờ kể cả không có ai dùng.
- Chi phí cận biên mỗi phiên sống: CPU Spot ~$0.02/giờ, GPU shared $0.35/giờ, dedicated $0.68-1.31/giờ.
- Nút chi phí lớn nhất: GPU shared pool chỉ chạy OD và `expireAfter: Never` ⇒
  node có phiên sẽ tồn tại tới khi phiên đóng + `consolidateAfter` 5m.
- EBS node 100Gi + S3 workspace sync là 2 mục co giãn chủ yếu còn lại theo user data.

---
*Cập nhật 2026-10-23. Xem `docs/aws-resource-map.md` cho sơ đồ service
và `docs/OPERATIONS.md` cho vận hành/tắt chi phí khi không dùng (destroy stack 01).*
