# Kế hoạch tối ưu chi phí — JupyterHub GPU Sandbox (dev/lab, Sydney)

> Kế hoạch đã **chốt ngày 2026-10-23**, trạng thái: **CHƯA apply** (Terraform và
> manifests chưa được sửa). Số liệu giá đối chiếu `docs/aws-cost-report.md`.
> Phạm vi: cấu hình dev/lab ở `ap-southeast-2`; các mục đánh dấu để nguyên khi
> lên prod `managed_per_az`.

## 1. Các mục đã chốt

### Mục 1 — System MNG thu gọn còn 1 node (dev)

- Hiện tại: `terraform/modules/eks/main.tf` `min_size = desired_size = 2`, `max_size = 4`.
- Sửa: dev `min_size = desired_size = 1`, giữ `max_size = 4` để tự scale khi có user.
- Trade-off: 1 node là single point; coredns 2 replica cùng đậu 1 node (chấp nhận lab).
- Tiết kiệm: ~$87/th (bỏ 1 node).

### Mục 2 — System node đổi sang t4g.large (ARM Graviton)

- Sửa default var `system_instance_types` = `["t4g.large"]`
  (`terraform/stacks/01-foundation/variables.tf`).
- Giá Sydney OD ~$0.0668/giờ ≈ **$48.7/th/node** (m6i.large $87.6/th → -44%).
- Pods hệ thống (hub, configurable-http-proxy, karpenter, LB controller, coredns,
  kube-proxy, aws-node) đều multi-arch ARM64 được xác nhận.
- Không xuống dưới 8GB RAM: tổng requests system pods + placeholder ~4-5GB.
- Note t4g burstable: spawn loạt nhiều user gây CPU spike — cân nhắc bật
  `unlimited` burst mode hoặc chấp nhận throttle chốc lát trong dev.
- Apply sẽ rolling-replace node — hub offline vài phút, làm lúc không có user.

### Mục 3 — Notebook CPU mở cả ARM (single pool + multi-arch image)

- `manifests/nodepool-cpu-user.yaml`: bỏ pin `kubernetes.io/arch: amd64`,
  cho phép `In [amd64, arm64]` → Karpenter tự chọn node rẻ nhất (Graviton rẻ hơn
  x86 cùng size ~20-25%, cho phiên CPU).
- Điều kiện bắt buộc: image CPU trong ECR phải build **multi-arch** — hiện chỉ
  có tag amd64; pod ARM trên image amd64 sẽ `exec format error` ngay khi spawn.
- GPU NodePool giữ nguyên (hình đã có sẵn driver agent; không đổi arch).
- Mức này chỉ giảm chi phí per-session, không đổi fixed cost.

### Mục 4 — CloudWatch logs cắt gọn (dev)

- Retention các log group = **7 ngày** (mặc định "never expire" gây tích phí lưu).
- Control-plane logging chỉ bật `audit` + `api`; tắt `scheduler`,
  `controllerManager`, `authenticator` (spam, ít giá trị lab).
- Metrics DCGM/vram-guard giữ trong hạn mức always-free (10 custom metrics,
  10 alarms, 5GB log ingest).

## 2. Mục đã loại bỏ (kèm lý do)

- **Spot cho system MNG**: tiết kiệm chỉ ~$30/th/node nhưng mỗi lần Spot reclaim
  làm configurable-http-proxy chết ⇒ gateway mọi user down 3-6 phút (kernels vẫn
  chạy, workspace an toàn nhờ S3 backup, nhưng experience xấu). Không đáng —
  system MNG giữ **On-Demand**. Spot đã dùng đúng chỗ ở NodePool `cpu-user`
  (nơi gián đoạn chỉ ảnh hưởng 1 phiên riêng).
- Không đổi: fck_nat ($4/th), ALB, Secrets Manager, cấu hình GPU pools.
- Tuỳ chọn sau (chưa chốt): lifecycle S3 expire noncurrent 7-14 ngày; ECR giữ
  2-3 image (GPU image 5-10GB/tag phình nhanh); thay ALB bằng Cloudflare tunnel
  chỉ dev (-$25/th).

## 3. Chi phí cố định sau tối ưu (idle 0 user)

| Khoản | ap-southeast-2/th (trước) | ap-southeast-2/th (sau) |
|---|---|---|
| EKS control plane | $73 | $73 |
| MNG system (2 × m6i.large) | $175 | **$49** (1 × t4g.large) |
| EBS node system | ~$10 | ~$2 |
| fck_nat (lab) | ~$4 + data | ~$4 + data |
| ALB | ~$25 + LCU | ~$25 + LCU |
| RDS db.t4g.micro + 20GB gp3 | ~$22 | ~$22 |
| S3 + ECR + Secrets + Route53 + SQS/CW ~ | ~$5 | ~$5 |
| **Tổng fixed — lab** | **≈ $320** | **≈ $180** |
| NAT managed ×3 (prod) | $129 + data | $129 + data |
| VPC endpoints interface (prod) | ~$147 | ~$147 |
| **Tổng fixed — prod** | **≈ $570** | **≈ $452 (tự động giảm nhờ mục 1-2)** |

- Save ~**$140/th** ở lab (~44%), ~$118/th ở prod, chỉ nhờ mục 1 + 2.
- Mục 3 + 4 không tính vào fixed cost (giảm chi phí phiên + phí lưu log).
- Kèm thói quen **destroy stack 01 khi không lab** (theo OPERATIONS), bill thật
  theo tuần sử dụng: dùng 2 tuần/th ⇒ ~$90-100 tiền thật vào phần fixed.
- Credit Free Tier account mới ($100 + tối đa $100 activity) tự trừ vào bill —
  phủ được phần lớn tháng đầu; xem FAQ trong `docs/aws-cost-report.md`.

## 4. Thứ tự apply (khi chuyển sang build)

1. Mục 1 + 2: sửa eks module + var `system_instance_types` → `terraform plan`
   kiểm rolling-replace → apply lúc vắng user.
2. Mục 3: build multi-arch image CPU (Dockerfile `FROM --platform` cho
   arm64/amd64) ⇒ push 2 image lên ECR ⇒ sửa endpoint `nodepool-cpu-user.yaml`
   ⇒ apply Karpenter manifest.
3. Mục 4: log group retention + EKS cluster logging selectors.
4. Bonus: emission note lên `docs/aws-cost-report.md` mục 2 (cột "sau tối ưu").
