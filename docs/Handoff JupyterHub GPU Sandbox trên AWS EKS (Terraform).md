# Handoff: JupyterHub GPU Sandbox trên AWS EKS (Terraform)

Oct 11, 2026 · @Izuki

## 1. Mục tiêu và phạm vi

Tài liệu này giao cho coding agent dựng hạ tầng Terraform cho nền tảng JupyterHub có GPU trên AWS EKS, phục vụ 50 người dùng ban đầu và thiết kế để mở rộng tới 2000 người dùng đồng thời.

- **Mục tiêu:** mỗi người dùng có một môi trường notebook sandbox riêng, ephemeral hoàn toàn (pod bỏ đi được, workspace được backup và khôi phục), có GPU đa dạng, chia hai gói: shared (chi phí thấp) và dedicated (có đảm bảo).
- **Trong phạm vi Terraform:** hạ tầng AWS và các thành phần Kubernetes cài bằng Helm hoặc manifest.
- **Ngoài phạm vi Terraform:** ứng dụng phải tự viết (bộ giám sát VRAM `vram-guard`, hook spawn của hub, CI build image). Tài liệu chỉ mô tả hợp đồng giao tiếp của chúng; Terraform chỉ triển khai chúng.
- **Cách dùng tài liệu:** mục 2 tách rõ "đã chốt" và "đề xuất, chưa chốt". Không tự đổi các mục đã chốt. Mọi mục ở mục 12 phải được kiểm tra theo tài liệu hiện hành trước khi viết code. Không giả định số phiên bản hay tên trường cấu hình nào trong tài liệu này.

## 2. Quyết định đã chốt và đề xuất

Bảy quyết định do người dùng nêu rõ là cố định; các đề xuất bên dưới là của người soạn và cần xác nhận trước khi coi là chốt.

| Nội dung | Trạng thái | Chi tiết |
| --- | --- | --- |
| Nền tảng | Đã chốt | JupyterHub trên EKS. Đã cân nhắc ECS (không có phí control plane EKS, khoảng 73 USD/tháng) nhưng chọn EKS vì chia sẻ GPU và hệ sinh thái Z2JH |
| Quy mô | Đã chốt | 50 người dùng ban đầu; kiến trúc phải mở rộng tới 2000 người dùng đồng thời; nhiều model GPU khác nhau |
| Môi trường | Đã chốt | Sandbox riêng cho từng người, ephemeral hoàn toàn; workspace được backup có quota dung lượng |
| Gói shared | Đã chốt | Time-slicing cho mọi người dùng trong một pool chung, không cô lập theo tổ chức. Overcommit VRAM là lợi thế. Có mức cam kết (commit) và mức trần (ceiling) kiểu balloon KVM, chấp nhận best-effort |
| Kill khi vượt VRAM | Đã chốt | Tự xây cơ chế giám sát và kill, không phụ thuộc hoàn toàn vào thư viện bên thứ ba |
| Gói dedicated | Đã chốt | Gói riêng cho người cần đảm bảo; chi tiết kỹ thuật chưa chốt (xem mục 5 và 12) |
| Image | Đã chốt | Chỉ image dựng sẵn cài công cụ phổ biến. Chưa cho người dùng tự tạo image hay template (hoãn lại) |
| Autoscaler | Đề xuất | Karpenter mã nguồn mở, không dùng EKS Auto Mode (cần chia nhỏ GPU và kiểm soát AMI, NodePool) |
| Đăng nhập | Đề xuất | Cognito hoặc OIDC/SSO sẵn có qua `oauthenticator` |
| DB của hub | Đề xuất | RDS PostgreSQL |
| Lưu workspace | Đề xuất | Pod ephemeral + đồng bộ S3 (xem mục 7) |
| Overcommit | Đề xuất | Bắt đầu chế độ A (burst chỉ từ phần chưa cam kết), hệ số 1.0; tăng dần theo số liệu đo |
| GPU | Đề xuất | Shared: dòng nhỏ (T4/L4/A10G). Dedicated: nguyên GPU nhỏ hoặc MIG trên A100/H100 |

## 3. Kiến trúc tổng thể

Một hub điều phối hai gói chạy trên hai pool GPU tách riêng: gói shared chia GPU bằng time-slicing, gói dedicated không chia sẻ.

&#91;embedded content: kiến trúc tổng thể · 2 gói, 2 pool GPU, dịch vụ dùng chung\]

JupyterHub (nhấn màu) nhận đăng nhập và spawn pod theo gói của người dùng. Pod gói shared nằm cùng node với vram-guard; cả hai gói đồng bộ workspace với S3 và kéo image từ ECR.

## 4. Phạm vi Terraform

Chia thành các module độc lập, triển khai theo ba stack để tránh phụ thuộc vòng giữa provider AWS và Kubernetes: (1) mạng + EKS + Karpenter, (2) add-on và GPU, (3) ứng dụng (JupyterHub và các thành phần phụ).

| Module | Tài nguyên chính | Ghi chú |
| --- | --- | --- |
| network | VPC nhiều AZ, subnet private (node) và public (ALB), NAT, VPC endpoint (S3, ECR, STS...) | CIDR đủ lớn hoặc thêm secondary CIDR; bật prefix delegation của VPC CNI vì có thể có hàng nghìn pod |
| eks | Cluster, OIDC/Pod Identity, access entries, add-on (vpc-cni, coredns, kube-proxy, ebs-csi, pod-identity-agent) | Managed node group hệ thống nhỏ, ổn định, không GPU, chỉ chạy hub, proxy, Karpenter, add-on |
| karpenter | IAM, hàng SQS ngắt Spot, Helm, EC2NodeClass và NodePool | Chi tiết mục 5 |
| gpu-stack | NVIDIA GPU Operator (hoặc device plugin + DCGM exporter), ConfigMap time-slicing, MIG manager cho pool dedicated | Cấu hình theo label của node, chi tiết mục 5 |
| ingress-dns | AWS Load Balancer Controller, ACM, Route53 | Domain là biến đầu vào |
| auth | Cognito user pool và app client, hoặc cấu hình OIDC ngoài | Claim: `user_id`, `plan`, tùy chọn `org_id` |
| hub-db | RDS PostgreSQL, Secrets Manager, KMS | Backup tự động, mã hóa |
| storage | S3 bucket workspace (versioning, lifecycle, SSE-KMS, chặn truy cập công khai), IAM cho hub cấp credential theo prefix | Chi tiết mục 7 |
| ecr | Repository cho image chuẩn, lifecycle policy, quyền kéo cho node | CI build image nằm ngoài Terraform |
| jupyterhub | Helm release Z2JH, values sinh từ `templatefile`, secret | Chi tiết mục 6 |
| observability | kube-prometheus-stack (hoặc dịch vụ managed), DCGM exporter, dashboard và alert | Metric của `vram-guard` (mục 10) |
| vram-guard | DaemonSet, ServiceAccount, RBAC, ConfigMap tham số, PodMonitor | Image và mã nguồn nằm ngoài Terraform |
| governance | Tag chuẩn, AWS Budgets và cảnh báo, yêu cầu Service Quotas cho GPU | Quota G và P cần xin sớm |
| backup | AWS Backup cho RDS (và EFS nếu dùng) | Retention là biến |

**Biến đầu vào chính:** `region`, `azs`, `vpc_cidr`, `domain`, `cluster_version`, `gpu_nodepools` (map mỗi pool một cấu hình), `plans` (quota theo gói), `workspace_quota_gib`, `tags`.

**Quy ước cho coding agent**

- Remote state (S3 và khóa), pin phiên bản provider và module, tách môi trường dev và prod.
- Không hard-code secret, ARN hay tên Region; mọi thứ là biến hoặc output.
- Chạy `terraform fmt`, `validate` và `plan` trước khi trình bày; mỗi module có README ngắn.
- Không đoán tên tham số: đối chiếu tài liệu provider và chart đang dùng. Nếu thiếu thông tin ở mục 12, hỏi lại thay vì tự giả định.

**Tham khảo đã thấy khi nghiên cứu (cần mở xác nhận):** repo `awslabs/ai-on-eks` (hạ tầng nền có Karpenter, NodePool GPU, biến bật JupyterHub), `awslabs/data-on-eks` (blueprint JupyterHub với Cognito), `aws-samples/karpenter-blueprints`, và tài liệu Z2JH. Một issue năm 2024 cho thấy blueprint mặc định từng gây pod không schedule do selector không khớp NodePool, nên dùng làm mẫu để học, không sao chép nguyên.

## 5. NodePool và chia sẻ GPU

Mỗi pool một mục đích, tách bằng label và taint để pod gói shared không bao giờ lên node dedicated.

| Pool | Phần cứng | Cách chia GPU | Ghi chú |
| --- | --- | --- | --- |
| system (managed node group) | CPU nhỏ | Không | Hub, proxy, Karpenter, add-on |
| cpu-user | Dòng m/c/r | Không | Profile không GPU; Spot và On-Demand |
| gpu-shared-`<family>` | Một pool cho mỗi họ GPU được chọn (đề xuất T4, L4, A10G; L40S nếu cần) | Time-slicing | Mọi người dùng gói shared dùng chung; scale về 0 khi không dùng |
| gpu-dedicated-`<...>` | GPU nhỏ một chiếc mỗi node; hoặc A100/H100 (p4d, p5) | Nguyên GPU hoặc MIG | Không chia sẻ; cần giữ capacity |

**Pool shared (time-slicing)**

- Cấu hình device plugin theo từng node qua label, để pool dedicated không bị time-slicing. Ví dụ ConfigMap (tên trường cần đối chiếu theo phiên bản device plugin đang dùng):

```yaml
version: v1
sharing:
  timeSlicing:
    renameByDefault: true
    failRequestsGreaterThanOne: true
    resources:
      - name: nvidia.com/gpu
        replicas: 6
```

- `renameByDefault` đổi tên resource thành `nvidia.com/gpu.shared` để pod không vô tình nhận một GPU nguyên. Số `replicas` khởi đầu 4 đến 8 cho T4 và L4, rồi đo độ trễ và chỉnh. Pool dùng một cỡ cam kết VRAM cố định, và số replica suy ra từ đó (xem mục 10).
- Time-slicing và MPS loại trừ nhau trên một node; dự án đã chốt dùng time-slicing, không dùng MPS.
- Dùng label do Karpenter gắn sẵn như `karpenter.k8s.aws/instance-gpu-name` và `instance-gpu-memory` để định tuyến profile theo loại GPU.
- Node taint theo tier (ví dụ `tier=shared:NoSchedule`) cộng toleration trong profile.

**Pool dedicated**

- GPU không có MIG (T4, L4, A10G, L40S): một người, một node, một GPU (instance một GPU như g4dn.xlarge, g6.xlarge, g5.xlarge).
- A100 và H100: MIG qua MIG manager của GPU Operator, cấu hình bằng label lúc node khởi động. Cấu hình khởi đầu gợi ý: A100 40 GB dùng `2g.10gb` (3 người mỗi GPU); H100 80 GB dùng `1g.10gb` (7 người mỗi GPU). Một node dùng một hình học MIG cố định.
- Capacity P4 và P5 khó có sẵn: dùng Capacity Block hoặc đặt trước, và xin Service Quotas sớm.

**Cài đặt Karpenter**

- Pod người dùng phải gắn annotation `karpenter.sh/do-not-disrupt: "true"` để consolidation không gỡ node đang có phiên. Kiểm tra hành vi của `expireAfter` theo phiên bản Karpenter và đặt đủ dài hoặc tắt cho pool GPU người dùng.
- Đặt `limits` cho từng NodePool (tổng vCPU và GPU tối đa) làm chốt chặn chi phí.
- Bật user scheduler của Z2JH để xếp người dùng dồn vào ít node, và dùng placeholder để giảm thời gian chờ scale-up.
- `EC2NodeClass`: AMI tăng tốc có driver NVIDIA (Bottlerocket NVIDIA hoặc AL2023 NVIDIA, kiểm tra tài liệu), `httpPutResponseHopLimit: 1` cho IMDS (mục 9), mã hóa EBS bằng KMS.

## 6. JupyterHub (Z2JH)

Hub chạy một replica trên pool system, spawn mỗi người dùng một pod qua KubeSpawner. Phiên bản chart và tên trường cấu hình phải kiểm tra theo tài liệu Z2JH hiện hành.

- **DB:** PostgreSQL ngoài (RDS) thay vì SQLite.
- **Giới hạn spawn:** `concurrent_spawn_limit` mặc định là 100; tăng có kiểm soát theo năng lực hub. `active_server_limit` đặt theo năng lực cluster.
- **Culler:** idle culler bật; timeout ngắn cho profile GPU shared, dài hơn cho dedicated. Giá trị khởi đầu chỉ để tinh chỉnh sau (ví dụ 30 đến 60 phút cho shared).
- **Đăng nhập:** `oauthenticator` qua Cognito hoặc OIDC. Claim cần có: `user_id`, `plan` (`shared` hoặc `dedicated`), tùy chọn `org_id` (chỉ dùng để tính phí và báo cáo, không dùng để cô lập GPU).
- **Profile:** `profile_list` dạng hàm, lọc theo `plan`. Gói shared thấy profile CPU và GPU shared; gói dedicated thấy profile dedicated.
- **Hook spawn:** hub gắn cho mỗi pod:
  - annotation `vram.example.com/commit-mib` và `vram.example.com/ceiling-mib` (tên có thể đổi, phải khớp với `vram-guard`);
  - label `plan`, `user`, `org` để theo dõi chi phí;
  - `karpenter.sh/do-not-disrupt: "true"`, `nodeSelector` và `tolerations` theo pool;
  - resources: `cpu`, `memory`, `ephemeral-storage`, `nvidia.com/gpu.shared: 1` (hoặc resource dedicated);
  - biến môi trường an toàn cho overcommit: `TF_FORCE_GPU_ALLOW_GROWTH=true`, `XLA_PYTHON_CLIENT_PREALLOCATE=false`.
- **Quota ở tầng hub:** số phiên GPU đồng thời theo người và theo gói, hạn mức giờ GPU. Đếm trong hook spawn, vì Z2JH mặc định chạy mọi pod trong một namespace nên ResourceQuota của Kubernetes khó chia theo người hay tổ chức.
- **Dừng phiên:** đặt `terminationGracePeriodSeconds` đủ dài để sidecar đồng bộ workspace lần cuối (mục 7).
- **Mở rộng:** một hub phục vụ đến vài trăm người đồng thời là hợp lý theo tài liệu capacity planning, nhưng không có benchmark chính thức cho 2000. Thiết kế `values.yaml` để tách thành nhiều hub dùng chung cluster khi cần (khuyến nghị của người soạn, chưa có nguồn).

## 7. Lưu trữ workspace và backup

Pod hoàn toàn ephemeral; toàn bộ thư mục workspace của người dùng được backup lên S3 với quota dung lượng. Đây là đề xuất, cần xác nhận (mục 12).

**Giữ lại:** notebook (kèm output), code, dữ liệu nhỏ, file cấu hình dự án, dotfile cần thiết, danh sách gói đã cài (`requirements.txt` hoặc `environment.yml`), cài đặt JupyterLab và kernelspec do người dùng tạo.

**Không giữ:** trạng thái kernel (RAM và VRAM), `~/.cache`, cache pip và conda, cache Hugging Face, `.ipynb_checkpoints`, `__pycache__`, `node_modules`, file tạm, thông tin xác thực. Dataset và checkpoint lớn đi qua S3 một cách tường minh, không nằm trong workspace đồng bộ.

**Cơ chế**

1. Init container tải workspace từ `s3://<bucket>/users/<id>/` vào thư mục làm việc (emptyDir hoặc đĩa cục bộ của node).
2. Sidecar đồng bộ định kỳ (khoảng vài phút một lần) với danh sách loại trừ ở trên.
3. Hook `preStop` chạy một lần đồng bộ cuối; `terminationGracePeriodSeconds` đủ dài.
4. S3 bật versioning và lifecycle (giữ phiên bản cũ một thời gian rồi xóa); đây là bản backup cho phép lấy lại file bị xóa nhầm.

**Quota**

- Đặt giới hạn `ephemeral-storage` của pod bằng quota cộng một khoảng đệm (Kubernetes sẽ evict pod nếu vượt).
- Cảnh báo người dùng khi đạt khoảng 80%; từ chối đồng bộ lên S3 khi vượt quota.
- Giới hạn kích thước file đơn và số lượng file. Mức mặc định tham khảo 5 đến 20 GB, chốt theo từng gói.

**Quyền S3**

- Hub gọi STS `AssumeRole` với session policy giới hạn đúng prefix `users/<id>/`, và chỉ truyền thông tin xác thực ngắn hạn cho sidecar, không truyền cho container chính của người dùng.
- Terraform tạo IAM role cho hub (được phép assume), policy mẫu cho session policy, và bucket policy chặn truy cập chéo prefix. Chi tiết quyền cần review kỹ vì đây là ranh giới cô lập dữ liệu.

**Phương án thay thế đã cân nhắc:** EBS theo người dùng (quota cứng, gắn theo AZ, nhiều volume), EFS (không có quota cho từng thư mục theo tài liệu hỏi đáp của AWS), FSx for OpenZFS (có quota theo user hoặc group nhưng phức tạp và đắt hơn).

**Khác:** backup RDS của hub (bản ghi người dùng, gói, quota), mã hóa bằng KMS, chính sách xóa dữ liệu khi người dùng rời đi và thời hạn lưu trữ.

## 8. Container image dựng sẵn

Giai đoạn này chỉ có image chuẩn do đội vận hành duy trì; người dùng chưa được tự tạo image hay template.

- **Phạm vi Terraform:** tạo ECR repository, lifecycle policy (giữ vài bản mới nhất), quyền kéo cho node và quyền đẩy cho CI. Việc build image nằm ngoài Terraform.
- **Danh sách khởi đầu (ví dụ, chốt sau):** data science CPU; PyTorch GPU; TensorFlow GPU; JAX GPU. Mỗi image gắn theo phiên bản CUDA.
- **Yêu cầu chung:** tương thích single-user server của phiên bản Z2JH đang dùng; chạy non-root; không chứa secret; CUDA tương thích với driver trên node của từng pool (cần một ma trận tương thích CUDA và driver).
- **Mặc định an toàn cho overcommit:** đặt sẵn `TF_FORCE_GPU_ALLOW_GROWTH=true` và `XLA_PYTHON_CLIENT_PREALLOCATE=false`.
- **Giai đoạn sau:** extension nhả cache khi nhận tín hiệu `SIGUSR1` (gọi `gc.collect()` và `torch.cuda.empty_cache()`) để phục vụ thu hồi mềm (mục 10).
- **Kéo image nhanh:** image GPU nặng nhiều GB; dùng image puller của Z2JH để kéo trước, và cân nhắc node image có sẵn cache các lớp base.
- **Vá bảo mật:** rebuild định kỳ, bật quét lỗ hổng của ECR.
- **Hoãn lại:** template cá nhân (tối đa 3 mỗi người), đặc tả YAML, pipeline build trên NodePool riêng. Thiết kế sơ bộ đã được bàn nhưng chưa triển khai ở giai đoạn này.

## 9. Bảo mật và cô lập sandbox

Người dùng chạy code tùy ý, nên ranh giới cô lập nằm ở mạng, quyền AWS và tài nguyên, không phải ở GPU.

- **IMDS:** đặt hop limit bằng 1 trong `EC2NodeClass` và chặn thêm bằng NetworkPolicy để pod người dùng không lấy được credential của node.
- **Quyền AWS:** dùng EKS Pod Identity hoặc IRSA, quyền tối thiểu cho từng thành phần. Pod người dùng không có role AWS, ngoại trừ credential STS giới hạn theo prefix dành cho sidecar workspace (mục 7).
- **Mạng:** NetworkPolicy (VPC CNI network policy hoặc Calico, Cilium) chặn pod người dùng gọi lẫn nhau, gọi vào hub API và API server. Egress ra internet qua NAT; có thể thêm proxy hoặc allowlist sau.
- **Pod người dùng:** Pod Security Standards mức restricted, non-root, không privileged, ResourceQuota và LimitRange cho CPU, RAM, ephemeral-storage.
- **vram-guard:** cần `hostPID` và truy cập NVML nên phải chạy privileged, đặt trong namespace hệ thống riêng, RBAC chỉ gồm quyền cần thiết (đọc pod, xóa pod). Người dùng không được chạm tới.
- **Mã hóa:** KMS cho S3, RDS, EBS; secret trong Secrets Manager hoặc SSM; TLS ở ALB.
- **GPU dùng chung (đã chấp nhận):** gói shared cho nhiều người lạ dùng chung GPU bằng time-slicing, vốn không cô lập VRAM hay lỗi giữa các pod. Cần nêu rõ trong điều khoản dịch vụ, khuyến cáo không đưa dữ liệu nhạy cảm, và dùng gói dedicated khi cần cô lập.
- **Lỗi GPU:** theo dõi lỗi Xid qua DCGM; tự động cordon và dọn node khi GPU báo lỗi để một người không kéo cả node.
- **Chống lạm dụng:** giới hạn thời lượng phiên, hạn mức giờ GPU, idle timeout; cảnh báo khi GPU hoạt động kéo dài mà không có hoạt động notebook.

## 10. vram-guard: giám sát VRAM, commit và ceiling

`vram-guard` là một DaemonSet chạy trên node `gpu-shared-*`, đo VRAM theo từng pod và thu hồi khi vượt mức. Mã nguồn do đội ứng dụng viết; Terraform chỉ triển khai (DaemonSet, ServiceAccount, RBAC, ConfigMap tham số, PodMonitor).

**Ngữ nghĩa** (kiểu balloon KVM, best-effort)

- Mỗi pod có `commit` (mức cam kết) và `ceiling` (mức trần), lấy từ annotation do hub gắn lúc spawn.
- Pod được dùng vượt `commit` khi GPU còn dư, nhưng không bao giờ vượt `ceiling`.
- Pod đang dùng không quá `commit` không bao giờ bị kill vì tranh chấp.
- Không có swap VRAM trong suốt: "thu hồi" nghĩa là người dùng nhả bộ nhớ hoặc bị kill.

**Phân phối cam kết:** giai đoạn đầu mỗi pool dùng một cỡ `commit` cố định, số replica time-slicing suy ra từ đó (kế toán theo từng GPU đơn giản). `commit` thay đổi theo pod trên node nhiều GPU cần kế toán theo từng GPU và để lại cho giai đoạn sau.

**Đo lường:** đọc NVML mỗi vài giây để lấy VRAM của từng tiến trình compute; ánh xạ PID sang pod qua `/proc/<pid>/cgroup` (cần `hostPID`); cộng theo pod.

**Vòng lặp thu hồi** (mỗi GPU, khoảng 2 giây)

```
used[i]  = VRAM đang dùng của pod i
free     = total - sum(used) - buffer
owed     = sum(max(0, commit[i] - used[i]))
nếu owed > free:                     # burster đang ăn vào phần cam kết của người khác
    cand = pod có used > commit, xếp theo (used - commit) giảm dần
    bước 1: gửi SIGUSR1 (nhả cache), chờ grace 10-30 giây
    bước 2: nếu vẫn owed > free thì kill cand[0], lặp lại
với pod có used > ceiling: kill
```

**Thứ tự chọn nạn nhân khi overcommit:** pod vượt `commit` nhiều nhất, rồi pod giữ VRAM nhưng GPU gần như nhàn rỗi, cuối cùng mới là pod đang hoạt động (kèm cảnh báo). Mỗi lần thu hồi ghi event Kubernetes và tăng metric Prometheus (số lần cảnh báo, kill, VRAM theo pod, tỷ lệ overcommit).

**Giai đoạn triển khai**

1. Chỉ ghi nhận (dry-run), thu thập phân bố VRAM thực tế.
2. Kill khi vượt `ceiling`.
3. Thu hồi theo cam kết và tăng hệ số overcommit từ 1.0 lên 1.2 đến 1.5 theo số liệu.

**Điểm cần kiểm chứng**

- NVML có trả dung lượng theo tiến trình trong đúng môi trường (loại instance, driver, hostPID) hay không; một số cấu hình trả giá trị không khả dụng.
- PyTorch giữ cache nên VRAM tính theo bộ nhớ thực chiếm, không chỉ tensor sống.
- Giữa hai lần lấy mẫu, burster có thể cấp phát một khối lớn khiến pod trong mức cam kết gặp lỗi OOM. Chế độ A (burst chỉ từ phần chưa cam kết) không có vấn đề này; chế độ B chỉ nên bật khi đã có số liệu.
- HAMi-core (chặn CUDA ở tầng thư viện) là lớp bổ sung tùy chọn, không phải điều kiện. Một tài liệu của Cozystack ghi nó phụ thuộc symbol glibc đã bị gỡ từ 2.34 và thất bại im lặng trên Ubuntu 24.04; một tài liệu khác ghi không hỗ trợ CUDA 13.0. Dự án không được phụ thuộc vào nó nếu chưa kiểm chứng trên image thực tế.

## 11. Quota, giới hạn và chi phí

Chi phí lớn nhất là GPU; các chốt chặn dưới đây nhằm giữ nó trong tầm kiểm soát khi mở rộng từ 50 lên 2000 người.

**Quota và giới hạn (giá trị khởi đầu để tinh chỉnh, chưa chốt)**

- Dung lượng workspace: 5 đến 20 GB mỗi người, chốt theo gói (mục 7).
- Idle timeout ngắn cho GPU shared, thời lượng phiên tối đa, hạn mức giờ GPU theo người và theo gói.
- Số phiên GPU đồng thời theo người; hệ số overcommit VRAM theo pool (bắt đầu 1.0).
- `limits` trên từng NodePool (tổng vCPU và GPU tối đa) và AWS Budgets với cảnh báo theo ngưỡng.
- Tag chi phí trên pod và node: `plan`, `user`, `org`, `tier`.
- Scale về 0 cho pool GPU shared khi không có người dùng; Spot chỉ cho pool CPU và workload chịu gián đoạn, không dùng cho phiên người dùng GPU vì bị thu hồi sẽ mất phiên.

**Chi phí cố định ngoài GPU:** phí control plane EKS (khoảng 73 USD/tháng), ALB, NAT hoặc VPC endpoint, RDS, S3 và ECR, monitoring, node hệ thống, egress dữ liệu.

**Số liệu giá tham khảo cho gói dedicated** (on-demand, us-east-1, lấy từ các trang theo dõi giá của bên thứ ba vào tháng 10/2026; phải đối chiếu lại trang giá chính thức của AWS và Region được chọn)

| Cấu hình | Giá instance mỗi giờ | Giá mỗi GPU mỗi giờ | Giá mỗi slice mỗi giờ (lấp đầy) |
| --- | --- | --- | --- |
| p5.48xlarge (8× H100 80 GB), MIG 1g.10gb × 7 | 55.04 USD | 6.88 USD | 0.98 USD |
| p4d.24xlarge (8× A100 40 GB), MIG 2g.10gb × 3 | 21.96 USD | 2.74 USD | 0.91 USD |

- Ví dụ 50 người, mỗi người 10 GB VRAM, chạy 24/7: khoảng 40.2 nghìn USD/tháng với một p5.48xlarge, hoặc khoảng 48.1 nghìn USD/tháng với ba p4d.24xlarge. Đây là chi phí compute khi mọi slice đều được giữ; chi phí thực cao hơn nếu slice bỏ trống.
- Savings Plan 1 năm cho p5 được một nguồn ghi khoảng 38.53 USD/giờ. Các báo giá p5 khoảng 98 USD/giờ là giá cũ trước đợt giảm giá năm 2025, không dùng.
- Giá và sự sẵn có khác nhau giữa các Region. Với P4 và P5 nên cân nhắc Capacity Block hoặc đặt trước thay vì trông chờ capacity theo yêu cầu.

## 12. Câu hỏi mở, rủi ro và mục cần xác minh

Bảy câu hỏi dưới đây chưa có câu trả lời của người dùng; coding agent hỏi lại khi gặp, hoặc dùng mặc định ghi ở cột cuối nếu được phép.

| Câu hỏi | Vì sao quan trọng | Mặc định nếu chưa có |
| --- | --- | --- |
| Region và AZ | Quota, giá và sự sẵn có GPU khác nhau theo Region | Không có mặc định; là biến bắt buộc |
| Họ GPU cho shared và dedicated | Quyết định NodePool, chi phí, có dùng MIG hay không. Lưu ý: yêu cầu ban đầu nhắc "P4" (Tesla P4); AWS không có instance Tesla P4, gần nhất là T4 (g4dn) | Shared: T4, L4, A10G. Dedicated: GPU nhỏ một chiếc mỗi node |
| Cách lưu workspace | Ảnh hưởng quota, thời gian khởi động, chi phí | Pod ephemeral + đồng bộ S3 |
| Nhà cung cấp đăng nhập | Cấu hình auth và claim | Cognito |
| Cỡ `commit` và `ceiling`, hệ số overcommit, quota theo gói | Quyết định mật độ người dùng trên một GPU và giá | Giá trị khởi đầu ở mục 10 và 11 |
| Định nghĩa gói dedicated | Nguyên GPU hay MIG, mức cam kết, capacity phải giữ | Nguyên GPU nhỏ; MIG A100/H100 là tùy chọn sau |
| Domain và mạng (công khai hay riêng) | ACM, Route53, ALB | Không có mặc định; là biến bắt buộc |

**Rủi ro và điều cần xác minh trước khi code**

- Time-slicing không cô lập VRAM hay lỗi giữa các pod; gói shared chấp nhận điều này (mục 9). Cam kết VRAM ở chế độ B chỉ là best-effort do độ trễ phản ứng.
- Phiên bản chart Z2JH, GPU Operator, device plugin và Karpenter: tên trường cấu hình và label (ví dụ label cấu hình MIG) phải đối chiếu theo tài liệu đang dùng, không suy từ tài liệu này.
- NVML có trả VRAM theo tiến trình trong môi trường thực tế hay không (mục 10).
- Capacity P4 và P5 khó có sẵn; xin Service Quotas sớm.
- Không có benchmark chính thức cho một hub JupyterHub ở 2000 người đồng thời; kiến trúc để ngỏ khả năng tách thành nhiều hub (khuyến nghị chưa có nguồn).
- Blueprint tham khảo có thể lỗi với cấu hình mặc định (issue năm 2024 về selector và NodePool).
- Số liệu giá lấy từ trang bên thứ ba và có nguồn cũ mâu thuẫn; chỉ dùng để ước lượng bậc độ lớn.
- Hạn chế của HAMi-core nếu cân nhắc dùng (mục 10).

## 13. Thứ tự triển khai và tiêu chí hoàn thành

Triển khai theo bảy giai đoạn; mỗi giai đoạn chỉ bắt đầu khi giai đoạn trước đạt tiêu chí.

1. **Chuẩn bị:** chốt Region, domain, backend state; gửi yêu cầu Service Quotas cho họ G và P.
2. **Nền tảng:** mạng, EKS, node group hệ thống, Karpenter.
3. **GPU shared:** GPU stack, một pool time-slicing (một họ GPU), cấu hình device plugin.
4. **JupyterHub:** hub, auth, profile CPU và GPU shared, workspace S3 với quota, culler.
5. **vram-guard:** triển khai dry-run, rồi kill theo `ceiling`.
6. **Dedicated:** pool dedicated, profile và quota riêng.
7. **Hoàn thiện:** quan sát, ngân sách, hardening, kiểm thử tải với 50 người; lập kế hoạch kiểm thử lên hàng trăm và tách hub.

**Tiêu chí hoàn thành**

- [ ] `terraform plan` sạch và chạy lại không đổi (idempotent) trên môi trường dev.
- [ ] Karpenter tạo node CPU theo yêu cầu và gỡ node khi trống.
- [ ] Pod nhận được `nvidia.com/gpu.shared`, `nvidia-smi` chạy được và nhiều pod dùng chung một GPU.
- [ ] Người dùng đăng nhập, spawn thành công; workspace khôi phục sau khi pod bị xóa; vượt quota bị từ chối đồng bộ.
- [ ] Node đang có phiên không bị Karpenter consolidation gỡ.
- [ ] Pod người dùng không đọc được IMDS, không gọi được pod người dùng khác hay hub API.
- [ ] `vram-guard` dry-run ghi đúng VRAM theo pod; bật kill thì pod giả lập vượt `ceiling` bị dừng và có metric.
- [ ] Người dùng gói shared không thấy profile dedicated và ngược lại; quota theo gói được áp dụng.
- [ ] Budgets và cảnh báo hoạt động; tag chi phí xuất hiện đúng trong báo cáo.
