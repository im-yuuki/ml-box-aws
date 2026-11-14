# MLBox — Deployment Runbook

> Cập nhật: 2026-11-13. Trạng thái chi tiết và backlog: [`TODO.md`](../TODO.md).

Tài liệu này là quy trình triển khai **đầy đủ** của MLBox trên **một AWS account, một region**,
từ trạng thái trống đến hệ thống chạy được. Mọi lệnh dưới đây chạy từ thư mục gốc repository.

Bản runbook này đã được kiểm chứng bằng một lần phá toàn bộ hạ tầng và dựng lại từ đầu
(`01-foundation` → `07-admin`) trên region `ap-southeast-2`, account `451058046864`.

<<<<<<< HEAD
| Thành phần | Trạng thái | Ghi chú |
|---|---|---|
| `00-bootstrap` | ✅ Đã apply fresh | S3 state, DynamoDB lock, Route53 zone, ACM certificates và validation records |
| `01-foundation` | ✅ Đã apply | VPC, EKS, system node group, Karpenter, CPU NodePool |
| `02-platform` | ✅ Đã apply | RDS, Cognito, ALB, Route53 aliases, Load Balancer Controller |
| DNS / ACM | ✅ Hoàn tất | Cloudflare delegate `mlbox` sang Route53; cả hai certificate đều `ISSUED` |
| `03-hub-app` | ✅ Đã apply | JupyterHub tại `notebook.mlbox.june8th.me`, có BFF service token |
| Hub theme | ✅ Đã apply | ConfigMap theme MLBox và rollout Hub |
| `04-dashboard` | ✅ Đã apply | Dashboard + BFF, apex listener rule và healthy target |
| `05-gpu` (tên cũ `99-unverified-gpu`) | ✅ Đã apply | Device plugin (time-slicing `nvidia.com/gpu`) và dcgm-exporter; GPU quota On-Demand G/VT = 8 vCPU |
| `08-alerting` | ✅ Đã apply (2026-11-14) | SNS topic, IRSA roles (alertmanager, fluent-bit), 8 CloudWatch alarms (ALB, RDS) → SNS |
| `monitoring` (kube-prometheus-stack + fluent-bit) | ✅ Đã cài (2026-11-14) | namespace `monitoring` (Prometheus/Alertmanager), `amazon-cloudwatch` (fluent-bit → `/mlbox`) |
| GPU profile trong hub | ⚠️ Đã bật | Đã kiểm chứng trên g4dn (T4); shared L4 (g6) phụ thuộc capacity AWS |
| BFF / dashboard | ✅ Đã deploy, ⚠️ chưa E2E | Health 200; route Project/Team/lời mời/artifact đã có; luồng trình duyệt với tài khoản thật chưa kiểm chứng |
=======
## 1. Nguyên tắc
>>>>>>> origin/master

- 1 cluster EKS cho mỗi region. Tên cluster: `jhub-gpu-sandbox-<env>-<region code>`, ví dụ
  `jhub-gpu-sandbox-dev-apse2` (mã region ngắn vì IAM `name_prefix` giới hạn 38 ký tự).
- 8 stack Terraform, mỗi stack một state riêng trên S3. `00-bootstrap` tạo backend state và giữ
  state **local**; 7 stack còn lại dùng remote state.
- Không tạo, sửa hoặc xóa resource ngoài Terraform. `kubectl edit` chỉ dùng để debug, phải đồng bộ
  lại Terraform ngay sau đó.
- Luôn pin image theo commit SHA (`<40 hex>`). Không dùng `latest` cho production.
- DNS: Route53 là authoritative của zone `mlbox.june8th.me`; Cloudflare (hoặc registrar) chỉ giữ bản
  ghi NS delegation ở zone cha.

## 2. Thứ tự stack

| Bước | Stack | Nội dung | Bắt buộc |
|---|---|---|---|
| 1 | `00-bootstrap` | Bucket state + bảng lock DynamoDB + zone Route53 + 2 chứng thư ACM + sinh `backend.hcl` cho 01–07 | ✅ 1 lần / account |
| 2 | `01-foundation` | VPC, EKS 1.36, managed node group, Karpenter, NodePool `cpu-user` | ✅ |
| 3 | `02-platform` | Bucket S3 workspace, RDS (hub + usage), Cognito, ALB + target group, Load Balancer Controller, RBAC cho GitHub deployer, namespace `dashboard` | ✅ |
| 4 | `06-storage` | EFS + addon EFS CSI driver + StorageClass `efs-sc` + IAM role của CSI | ✅ **trước 03** |
| 5 | `03-hub-app` | JupyterHub (Z2JH), TargetGroupBinding, listener HTTP/HTTPS | ✅ |
| 6 | `deploy/apply-hub-theme.sh` | ConfigMap theme MLBox cho Hub | ✅ |
| 7 | `04-dashboard` | Dashboard + BFF, apex listener rule | ✅ |
| 8 | `05-gpu` | NVIDIA device plugin (time-slicing) + DCGM exporter | ⭕ tuỳ chọn |
| 9 | `07-admin` | Admin console tại `admin.<domain>` | ⭕ tuỳ chọn |

```text
00-bootstrap → 01-foundation → 02-platform → 06-storage → 03-hub-app → theme → 04-dashboard
                                                                                              ├→ 05-gpu
                                                                                              └→ 07-admin
```

> `06-storage` phải apply **trước** `03-hub-app`: mỗi Project tạo một PVC với StorageClass `efs-sc`,
> và StorageClass này do `06-storage` tạo. Apply `03-hub-app` trước sẽ ra pod `Pending` vì
> `no persistent volumes available for this claim`.

## 3. Điều kiện trước khi bắt đầu

Công cụ:

- AWS CLI v2 (`>= 2.40`, có lệnh `aws login`), Terraform `>= 1.6`, `kubectl`.
- Helm không cần cài khi chạy Terraform: chart được cài bởi provider `helm` trong Terraform.
- Docker + Buildx chỉ cần khi muốn build image thủ công; CI đã publish sẵn image lên GHCR.
- Máy chạy Terraform nên có tối thiểu 2 vCPU / 4 GB RAM và mạng ra GHCR.

Tài khoản AWS:

- Quyền `AdministratorAccess` là đủ cho lab. Người apply cần quyền tạo IAM role, ACM, Route53, RDS,
  EKS, EFS, ELB và đọc CloudWatch.
- Kiểm tra quota: EKS cluster, vCPU On-Demand, và (nếu bật GPU) GPU On-Domain. Thiếu quota là nguyên
  nhân phổ biến nhất khiến node không lên.

Miền và DNS:

- Một domain con, ví dụ `mlbox.june8th.me`. Bạn cần quyền khai báo bản ghi NS ở zone cha (Cloudflare
  hoặc registrar) để trỏ subdomain về Route53.
- Nếu bạn không dùng Cloudflare, làm đúng như bước “Khoảng nghỉ DNS/ACM” bên dưới: chỉ cần cập nhật
  4 nameserver mà `00-bootstrap` trả về.

## 4. Đăng nhập AWS

AWS CLI v2.40 trở lên có lệnh `aws login` (đăng nhập SSO và lưu phiên):

```bash
aws login
aws sts get-caller-identity
```

Bản cũ hơn dùng `aws sso login --profile <tên-profile>`. Profile cần đặt trong `~/.aws/config`:

<<<<<<< HEAD
- AWS CLI, Terraform `>= 1.6`, `kubectl`, Helm provider credentials, Docker Buildx và Helm CLI (`helm repo add prometheus-community https://prometheus-community.github.io/helm-charts; helm repo add nvidia https://nvidia.github.io/dcgm-exporter/helm-charts; helm repo add eks https://aws.github.io/eks-charts`).
- Quyền truy cập account/region đúng với backend S3.
- Cloudflare chỉ dùng để quản lý nameserver; zone `mlbox.june8th.me` hiện do Route53 quản lý.
- Không commit `backend.hcl`, `terraform.tfvars`, state, plan hoặc secrets.
=======
```ini
[profile <tên-profile>]
sso_start_url = https://ssoins-<id>.portal.us-east-1.app.aws/
sso_region    = us-east-1
sso_account_id = <account-id>
sso_role_name = AdministratorAccess
region        = ap-southeast-2
```
>>>>>>> origin/master

Terraform đọc profile qua biến môi trường. Trên Windows dùng wrapper `.private/aws-env.cmd`
(file này không commit), trên macOS/Linux:

```bash
export AWS_PROFILE=<tên-profile>
export AWS_REGION=ap-southeast-2
```

```bat
.private\aws-env.cmd terraform -chdir=terraform/stacks/02-platform plan
```

## 5. Bước 1 — `00-bootstrap` (một lần cho mỗi account)

```bash
cd terraform/stacks/00-bootstrap
terraform init
terraform plan
terraform apply
terraform output route53_zone_nameservers
terraform output notebook_certificate_status
terraform output dashboard_certificate_status
```

Stack này tạo:

- bucket S3 state (tên `jhub-gpu-sandbox-tfstate-<account-id>`) có versioning + SSE;
- bảng lock DynamoDB `jhub-gpu-sandbox-tflock`;
- zone Route53 `<domain>` và 2 chứng thư ACM (`<domain>` và `notebook.<domain>`) kèm bản ghi CNAME
  validation;
- file `backend.hcl` cho `01-foundation`, `02-platform`, `03-hub-app`, `04-dashboard`, `05-gpu`,
  `06-storage`, `07-admin`.

State của stack này là **local** (`terraform.tfstate` trong thư mục stack) và không được commit.
Bảo vệ file này: mất nó thì phải `terraform import` lại toàn bộ resource của bootstrap trước khi
muốn thay đổi hay phá stack này.

### Khoảng nghỉ DNS/ACM

Zone và chứng thư do `00-bootstrap` tạo, còn ALB và bản ghi alias do `02-platform` tạo. Vì vậy phải
hoàn tất delegation trước khi apply các stack cần HTTPS:

1. Lấy 4 nameserver: `terraform -chdir=terraform/stacks/00-bootstrap output route53_zone_nameservers`.
2. Ở zone cha (Cloudflare/registrar), khai báo NS delegation cho subdomain `mlbox` trỏ tới 4
   nameserver đó. Không tạo CNAME/TXT validation thủ công ở zone cha.
3. Chờ chứng thư ACM chuyển sang `ISSUED`:

```bash
aws acm describe-certificate \
  --certificate-arn "$(terraform -chdir=terraform/stacks/00-bootstrap output -raw notebook_certificate_arn)" \
  --query Certificate.Status --output text
```

Tham khảo [`deploy/DNS-CLOUDFLARE.md`](../deploy/DNS-CLOUDFLARE.md).

> Cảnh báo: khi Cloudflare mất quyền authoritative với zone này, mọi bản ghi đang nằm ở Cloudflare
> của `mlbox.june8th.me` sẽ ngừng phục vụ và phải tạo lại trong Route53. Các zone khác không đổi.

## 6. Bước 2 — `01-foundation`

```bash
cd terraform/stacks/01-foundation
terraform init -reconfigure -backend-config=backend.hcl
terraform plan
terraform apply
```

Apply mất khoảng 15–20 phút (EKS + Karpenter + node group). Không ngắt giữa chừng: nếu bị ngắt,
lock S3/DynamoDB có thể kẹt và node group mồ côi phải dọn bằng CLI.

Kiểm tra:

```bash
aws eks update-kubeconfig --name jhub-gpu-sandbox-dev-apse2 --region ap-southeast-2
kubectl get nodes
kubectl get nodepools,ec2nodeclasses
```

## 7. Bước 3 — `02-platform`

```bash
cd terraform/stacks/02-platform
terraform init -reconfigure -backend-config=backend.hcl
terraform plan
terraform apply
```

Tạo bucket S3 workspace (có KMS), RDS Postgres cho Hub và RDS Postgres cho usage history, Cognito user
pool + 2 client, ALB + target group, Load Balancer Controller (Helm), OIDC provider GitHub, IAM role
BFF, bảng DynamoDB `mlbox_sessions`, và namespace `dashboard` (stack này tạo namespace vì nó cũng
quản lý Role/RoleBinding của GitHub deployer bên trong namespace đó).

## 8. Bước 4 — `06-storage` (trước `03-hub-app`)

```bash
cd terraform/stacks/06-storage
terraform init -reconfigure -backend-config=backend.hcl
terraform plan
terraform apply
```

Kiểm tra:

```bash
kubectl get storageclass efs-sc
kubectl get pods -n kube-system -l app=aws-efs-csi-driver
```

## 9. Bước 5 — `03-hub-app`

```bash
cd terraform/stacks/03-hub-app
terraform init -reconfigure -backend-config=backend.hcl
terraform plan
terraform apply
```

Stack tự chờ chứng thư ACM `ISSUED` (`aws acm wait certificate-validated`, không phụ thuộc shell) rồi
mới tạo listener HTTPS. Nếu delegation chưa xong, lệnh báo lỗi tường minh thay vì treo.

Sau đó áp theme Hub:

```bash
cd ../../..            # về repository root
./deploy/apply-hub-theme.sh
```

Kiểm tra:

```bash
kubectl -n hub get pods,svc,targetgroupbinding
kubectl -n hub rollout status deployment/hub --timeout=300s
curl -sS -o /dev/null -w '%{http_code}\n' https://notebook.<domain>/hub/login
```

## 10. Bước 7 — `04-dashboard`

```bash
cd terraform/stacks/04-dashboard
terraform init -reconfigure -backend-config=backend.hcl
terraform plan
terraform apply
```

Cấu hình Cognito được truyền lúc container chạy (env do stack tạo):

```text
COGNITO_REGION=ap-southeast-2
COGNITO_USER_POOL_ID=<pool-id>
COGNITO_CLIENT_ID=<dashboard-client-id>
```

Kiểm tra:

```bash
kubectl -n dashboard get pods,svc,targetgroupbinding
kubectl -n dashboard rollout status deployment/dashboard --timeout=300s
aws elbv2 describe-target-health \
  --target-group-arn "$(terraform -chdir=terraform/stacks/04-dashboard output -raw dashboard_target_group_arn)"
curl -i https://<domain>/
```

## 12. Monitoring + alerting + logs (tuỳ chọn, 2026-11-14)

kube-prometheus-stack được cài bằng Helm với values `monitoring/kube-prometheus-stack-values.yaml` (namespace `monitoring`, chart 45.12.0). Sau khi stack monitoring sẵn, `05-gpu` apply với dcgm-exporter `serviceMonitor.enabled=true` (biến `enable_dcgm_service_monitor`, mặc định `true`). Lưu ý thứ tự: tạo CRDs (helm) **trước** khi apply dcgm-exporter, nếu không `serviceMonitor` sẽ fail. Các giá trị SNS/IRSA trong values cứng cho cluster này.

Stack `08-alerting` tạo SNS topic + IRSA roles + 8 CloudWatch alarms (ALB, RDS) + log group `/mlbox` (30 ngày). Không cần apply lại các stack khác.

```bash
cd terraform/stacks/08-alerting
terraform init -reconfigure -backend-config=backend.hcl
terraform plan
terraform apply
```

Sau đó apply monitoring trong `05-gpu`, rồi annotate SA (đã có trong `monitoring/kube-prometheus-stack-values.yaml`):

```bash
kubectl -n monitoring rollout restart statefulset/alertmanager-kube-prometheus-stack-alertmanager
```

Fluent Bit (không cần Terraform): `helm install aws-fluent-bit eks/aws-for-fluent-bit -n amazon-cloudwatch --create-namespace -f monitoring/fluent-bit-values.yaml`. Rollback: `helm uninstall aws-fluent-bit -n amazon-cloudwatch` và `terraform -chdir=terraform/stacks/08-alerting destroy` (xóa log group `/mlbox` + SNS topic + alarms).

## 12. Bước 8 — `05-gpu` (tuỳ chọn)

```bash
cd terraform/stacks/05-gpu
terraform init -reconfigure -backend-config=backend.hcl
terraform plan
terraform apply
```

Sau đó bật profile GPU trong `03-hub-app`:

```hcl
enable_gpu_profiles = true
```

Kiểm tra:

```bash
kubectl get nodes -l accelerator=nvidia
kubectl -n kube-system get pods | grep -E 'nvidia|dcgm'
```

## 13. Bước 9 — `07-admin` (tuỳ chọn)

Console quản trị tại `https://admin.<domain>`. Xem [`terraform/stacks/07-admin/README.md`](../terraform/stacks/07-admin/README.md).

```bash
cd terraform/stacks/07-admin
terraform init -reconfigure -backend-config=backend.hcl
terraform plan
terraform apply
```

Cần điền trong `terraform.tfvars`:

```hcl
state_bucket        = "<bucket state của 00-bootstrap>"
admin_image         = "ghcr.io/<owner>/mlbox-admin:<40-hex-sha>"
admin_password_hash = "scrypt$16384$8$1$<salt>$<hash>"
deploy_admin        = true
```

Tạo hash mật khẩu:

```bash
cd web/admin
npm install
npm run build
ADMIN_PASSWORD='mật khẩu >= 12 ký tự' npm run hash-password
```

Stack chỉ tạo IAM, chứng thư, DNS và target group khi `deploy_admin = false`; bật `true` ở lần apply
sau để tạo namespace, Deployment, Service và listener rule.

## 14. Image và GHCR

Workflow `.github/workflows/images.yml` build và push 5 image mỗi lần merge vào `master`:

```text
ghcr.io/<owner>/mlbox-dashboard   web/dashboard/Dockerfile
ghcr.io/<owner>/mlbox-bff         web/bff/Dockerfile
ghcr.io/<owner>/mlbox-admin       web/admin/Dockerfile
ghcr.io/<owner>/mlbox-cpu         images/cpu/Dockerfile
ghcr.io/<owner>/mlbox-gpu         images/gpu/Dockerfile
```

Tag là commit SHA đầy đủ (40 hex). Image phải tồn tại **trước** khi apply stack tương ứng, và package
phải public (hoặc cluster cần `imagePullSecret`).

```bash
# build và push thủ công khi cần image chưa có trên CI
PUSH=1 CR_PAT=<token> GHCR_USER=<user> ./scripts/build-images.sh
```

Các image `cpu`/`gpu` cần wheel `jlab_heroui_theme` trong `web/theme/lab/jlab-heroui-theme/dist/`;
script build tự dựng nếu thiếu.

## 15. Kiểm chứng sau khi triển khai

```bash
kubectl get nodes,nodepools
kubectl get pods -A
kubectl -n hub get pods,svc,targetgroupbinding
kubectl -n dashboard get pods,svc,targetgroupbinding
kubectl -n admin get pods,svc,targetgroupbinding

curl -sS -o /dev/null -w 'notebook: %{http_code}\n' https://notebook.<domain>/hub/login
curl -sS -o /dev/null -w 'dashboard: %{http_code}\n' https://<domain>/
curl -sS -o /dev/null -w 'login: %{http_code}\n' https://<domain>/login
curl -sS -o /dev/null -w 'quota: %{http_code}\n' https://<domain>/quota
curl -sS -o /dev/null -w 'admin: %{http_code}\n' https://admin.<domain>/healthz
```

Ngoài lệnh kiểm tra, **mở từng trang bằng trình duyệt** (không chỉ chạy lệnh): `/`, `/login`,
`/register`, `/projects`, `/teams`, `/quota`, `/account`, trang chi tiết Project, trang admin. Một route
trả 200 ở `curl` vẫn có thể lỗi ở trình duyệt (script, cookie, i18n).

## 16. Reset dữ liệu database

Hai Postgres đều do `02-platform` tạo: `jhub-gpu-sandbox-<cluster>-hub` (schema của JupyterHub) và
`jhub-gpu-sandbox-<cluster>-dashboard-usage` (schema của ứng dụng, tên DB `usage_history`).

Cách 1 — xoá sạch và dựng lại (dùng khi muốn trả hệ thống về trạng thái sau khi triển khai):

```bash
cd terraform/stacks/02-platform
terraform destroy      # xoá cả hai RDS, Cognito, bucket workspace
cd ../..
# dựng lại theo mục 5–10
```

Khi destroy, cần tắt deletion protection của database usage trước:

```hcl
dashboard_usage_deletion_protection      = false
dashboard_usage_final_snapshot_identifier = ""
```

`hub-db` đã mặc định `deletion_protection = false` và `skip_final_snapshot = true`.

Cách 2 — xoá dữ liệu nhưng giữ hạ tầng (nhanh hơn): xoá bucket workspace (kể cả các version cũ)
và truncate các bảng trong `usage_history`:

```bash
aws s3 rb s3://<bucket-workspace> --force --region <region>
```

Schema của ứng dụng được BFF tạo lần đầu khi có request xác thực
(`ensureSchema()` với `CREATE TABLE IF NOT EXISTS`), không phải lúc khởi động; do đó sau khi xoá
dữ liệu, chưa có bảng nào trong DB cho đến lần đăng nhập đầu tiên.

## 17. Phá hạ tầng (teardown)

Thứ tự ngược phụ thuộc:

```text
07-admin → 05-gpu → 04-dashboard → 03-hub-app → 06-storage → 02-platform → 01-foundation
```

```bash
cd terraform/stacks/07-admin      && terraform destroy
cd terraform/stacks/05-gpu        && terraform destroy
cd terraform/stacks/04-dashboard  && terraform destroy
cd terraform/stacks/03-hub-app    && terraform destroy
cd terraform/stacks/06-storage    && terraform destroy
cd terraform/stacks/02-platform   && terraform destroy
cd terraform/stacks/01-foundation && terraform destroy
```

Lỗi thường gặp khi destroy:

| Triệu chứng | Nguyên nhân | Cách xử lý |
|---|---|---|
| `BucketNotEmpty` khi xoá bucket workspace | Bucket bật versioning, còn version cũ | `aws s3 rb s3://<bucket> --force` (xoá cả version cũ) |
| `Cannot delete protected DB` | `deletion_protection = true` | Đặt `dashboard_usage_deletion_protection = false`, apply, rồi destroy |
| Destroy `01-foundation` kẹt ở data source EKS | State lệch với cluster | `terraform destroy -refresh=false` |
| Pod/node còn sót sau destroy | Karpenter tạo node ngoài state | `aws ec2 terminate-instances` và xoá ENI/volume thủ công |

Giữ `00-bootstrap` (bucket state, lock table, zone Route53, chứng thư ACM) khi chỉ muốn dừng lab.
Chỉ destroy `00-bootstrap` sau khi export toàn bộ state ra ngoài bucket.

## 18. Triển khai trên account của bạn

Bảng giá trị phải thay cho mọi tài khoản khác:

| Giá trị | Ở đâu | Ví dụ trong repo này |
|---|---|---|
| Domain | `terraform.tfvars` của 02, 03, 04, 07 | `mlbox.june8th.me` |
| `cognito_domain_prefix` | `terraform.tfvars` của 02, 03 | `mlbox-hub-apse2` (phải duy nhất trong region) |
| Owner GHCR trong image | `terraform.tfvars` của 03, 04, 07 | `im-yuuki` |
| `admin_password_hash` | `terraform.tfvars` của 07 | `npm run hash-password` trong `web/admin` |
| `state_bucket` | `terraform.tfvars` của 07 | `jhub-gpu-sandbox-tfstate-<account-id>` |
| Region | `terraform.tfvars` của 01, 02, 03, 04, 05, 06, 07 | `ap-southeast-2` (mặc định) |
| Profile AWS | biến môi trường | `AdministratorAccess-<account-id>` |

Checklist cho account mới:

1. `aws login` và xác nhận `aws sts get-caller-identity`.
2. Copy `terraform.tfvars.example` sang `terraform.tfvars` ở từng stack và điền giá trị.
3. Tạo zone `mlbox.<domain>` ở zone cha (delegate NS) trước hoặc sau khi apply `00-bootstrap` —
   sau khi apply là chuẩn, vì lấy nameserver từ output.
4. Chờ 2 chứng thư ACM `ISSUED`.
5. Apply lần lượt `01 → 02 → 06 → 03 → theme → 04`, rồi `05`/`07` nếu cần.
6. Kiểm tra theo mục 14, rồi đăng ký một tài khoản thật để chứng minh luồng Cognito.

Những giá trị đã hard-code trong code và phải chỉnh khi đổi tên/region: `project`
(`jhub-gpu-sandbox`), `env` (`dev`), `region_short` (`apse2`) trong `01-foundation/variables.tf`;
`terraform/stacks/07-admin/variables.tf` không còn hard-code account nữa.

## 19. Sự cố đã gặp (đừng lặp lại)

- Ngắt `apply` giữa chừng → lock kẹt (`force-unlock`) và node group mồ côi.
- Key addon EBS CSI phải là `aws-ebs-csi-driver`, không phải `ebs-csi`.
- Tên cluster dùng mã region ngắn vì IAM `name_prefix` giới hạn 38 ký tự.
- Destroy báo lỗi data source addon → `destroy -refresh=false`.
- Bucket state bật versioning: xoá bucket phải xả các version cũ trước.
- `02-platform` tạo namespace `dashboard` vì nó quản lý Role của GitHub deployer; apply
  `02-platform` trước `04-dashboard` sẽ không lỗi, apply ngược lại thì Role sẽ không tồn tại.
- **Karpenter node role thiếu `ecr:GetAuthorizationToken`**: mọi pod trên node do Karpenter
  tạo không pull được image từ ECR (`authorization failed: no basic auth credentials`),
  node không bao giờ Ready → Hub helm release timeout. Managed node group có quyền này qua
  `AmazonEKSClusterPolicy`; Karpenter node role không có. Đã thêm IAM policy
  `<cluster>-karpenter-node-ecr` vào `terraform/modules/karpenter/node-role.tf`.
- **AL2023 AMI (`al2023@latest`) không khởi động nodeadm lúc boot** trên node Karpenter (unit
  `nodeadm-config/run.service` không chạy lúc boot; node không có ECR credential provider, CNI
  không khởi tạo, node không bao giờ Ready). Đã fix bằng `userData` trong cả hai EC2NodeClass:
  script khởi động `nodeadm-config.service`, restart `containerd`/`kubelet` nếu thiếu
  `image-credential-provider-*`, rồi `systemctl --no-block` `nodeadm-run.service`. Lưu ý:
  `nodeadm-run.service` được order `After=cloud-final.service`, nên KHÔNG `systemctl start`
  blocking từ script chạy trong cloud-final (deadlock — node đầu tiên của tôi kẹt 10 phút vì lý
  do này). Đã kiểm chứng: node mới tạo từ EC2NodeClass đã update tự Ready sau ~90 giây và node
  cũ bị Karpenter drift/terminate tự động.
- **Stack `05-gpu`**: ConfigMap `time-slicing-shared` được apply trước namespace tồn tại →
  `namespaces "gpu-operator-resources" not found`. Đã thêm `kubectl_manifest` cho namespace trong
  `terraform/modules/gpu-stack` và `depends_on` tương ứng.
- **Chờ chứng thư ACM** dùng `aws acm wait certificate-validated` (không phụ thuộc shell) vì
  `interpreter = ["/bin/bash", "-c"]` không resolve được trên Windows.

## 20. Kết quả kiểm chứng (2026-11-13)

Toàn bộ stack `01-foundation` → `07-admin` đã được **phá hủy và dựng lại từ đầu** (giữ
`00-bootstrap`) để kiểm chứng khả năng redeploy. Kết quả:

- ALB, RDS (hub + usage history), Cognito, S3 workspace, EFS và Cognito pool đều được tạo lại mới;
  dữ liệu cũ không còn (schema ứng dụng sẽ được BFF tự tạo lúc khởi động, hiện không có bảng/dòng nào).
- `notebook.mlbox.june8th.me` trả `302` tới trang đăng nhập; `mlbox.june8th.me` trả `200` cho `/` và
  `/login`; `admin.mlbox.june8th.me` phục vụ console (đăng nhập chưa kiểm bằng tài khoản thật).
- Các trang dashboard kiểm qua trình duyệt: `/`, `/login`, `/register`, `/quota`, `/teams`, `/account`,
  `/projects`, `/forgot-password` — không có 404.
- Khắc phục trong quá trình verify: IAM ECR cho Karpenter node (image pull), thứ tự apply của stack
  `05-gpu`, cấu hình của Karpenter node với AL2023 AMI.

## 20. Tài liệu liên quan

- [`docs/OPERATIONS.md`](OPERATIONS.md) — health check, log, rollout, incident, chi phí.
- [`deploy/DNS-CLOUDFLARE.md`](../deploy/DNS-CLOUDFLARE.md) — chi tiết delegation DNS.
- [`terraform/stacks/*/README.md`](../terraform/stacks) — tài liệu riêng từng stack.
- [`TODO.md`](../TODO.md) — trạng thái chi tiết và backlog.
