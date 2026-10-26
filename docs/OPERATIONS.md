# ML Box — Operations Runbook

Tài liệu này mô tả các thao tác vận hành thường ngày cho ML Box trên AWS EKS. Quy trình hiện tại
mặc định dùng account `451058046864`, region `ap-southeast-2` và cluster
`jhub-gpu-sandbox-dev-apse2`.

## Trạng thái và nguyên tắc vận hành

- JupyterHub là notebook/API backend tại `https://notebook.mlbox.june8th.me`.
- Dashboard là public frontend tại `https://mlbox.june8th.me`.
- Luồng bắt buộc đã được redeploy fresh; CPU baseline đang chạy trên cluster
  `jhub-gpu-sandbox-dev-apse2`.
- Dashboard production đã được xác nhận qua ALB: `/` và `/login` trả `200`, target healthy,
  không còn lỗi `DYNAMIC_SERVER_USAGE`. BFF readiness nội bộ `/v1/health` trả `200`.
- Authenticated Cognito và sandbox lifecycle chưa được test vì chưa có test user.
- GPU chưa được bật; `99-unverified-gpu` chỉ được apply sau khi AWS cấp quota và image/plugin GPU
  đã được kiểm tra.
- Luôn pin image bằng tag immutable, ví dụ `dev-<git-short-sha>`. Không dùng `latest` cho rollout.
- Không sửa hoặc xóa state Terraform, secret, backend config hay resource production thủ công nếu
  chưa xác định stack sở hữu resource đó.
- Bốn KMS key lịch sử của project đã được xác nhận không còn alias/grant sử dụng và đang ở
  `PendingDeletion`; đây là trạng thái cleanup đúng của AWS. Không cancel deletion, vì KMS bắt
  buộc giữ waiting period trước khi xóa vĩnh viễn. Các key hiện tại của workspace/cluster vẫn
  do stack mới quản lý.

## Quyền truy cập và context

```bash
source .private/aws-env.sh
aws sts get-caller-identity
aws eks update-kubeconfig \
  --name jhub-gpu-sandbox-dev-apse2 \
  --region ap-southeast-2
kubectl config current-context
```

Nếu credentials hết hạn, đăng nhập lại bằng quy trình AWS của môi trường trước khi chạy lệnh
Terraform/AWS. Không đưa output token, cookie hoặc secret vào issue/log/commit.

## Health check nhanh

Chạy từ repository root:

```bash
kubectl get nodes
kubectl get pods -A
kubectl -n hub get pods,svc,targetgroupbinding
kubectl -n dashboard get pods,svc,targetgroupbinding

curl -sS -o /dev/null -w 'notebook: %{http_code}\n' \
  https://notebook.mlbox.june8th.me/hub/login
curl -sS -o /dev/null -w 'dashboard: %{http_code}\n' \
  https://mlbox.june8th.me/
```

Kỳ vọng tối thiểu:

- Node system và node CPU ở trạng thái `Ready`.
- `hub` và `dashboard` deployment có pod `Running`/`Ready`.
- Notebook trả `200` hoặc redirect hợp lệ tới login.
- Dashboard chỉ được coi là healthy khi `/`, `/login` và các route chính trả `200` trong
  production, không chỉ trong `next dev`.

Kiểm tra TargetGroupBinding và ALB target health:

```bash
kubectl -n hub get targetgroupbinding
kubectl -n dashboard get targetgroupbinding
terraform -chdir=terraform/stacks/04-dashboard output -raw dashboard_target_group_arn
aws elbv2 describe-target-health \
  --target-group-arn "$(terraform -chdir=terraform/stacks/04-dashboard output -raw dashboard_target_group_arn)"
```

## Xem log và debug rollout

### Kubernetes logs

```bash
kubectl -n hub get pods
kubectl -n hub logs deployment/hub --since=15m
kubectl -n hub logs deployment/hub --since=15m --all-containers
kubectl -n dashboard logs deployment/dashboard --since=15m
kubectl -n dashboard describe pod -l app=dashboard
```

Theo dõi rollout:

```bash
kubectl -n hub rollout status deployment/hub --timeout=300s
kubectl -n dashboard rollout status deployment/dashboard --timeout=300s
kubectl -n hub get events --sort-by=.lastTimestamp | tail -30
kubectl -n dashboard get events --sort-by=.lastTimestamp | tail -30
```

Nếu pod `Pending`, kiểm tra NodePool, quota, taint/toleration, resource request và event của pod.
Nếu pod `CrashLoopBackOff`, xem log container trước và container hiện tại, sau đó kiểm tra image/tag,
secret và environment.

### ALB/target timeout hoặc unhealthy

Phân biệt nguyên nhân theo `TargetHealth.Reason`:

- `Target.Timeout`: kiểm tra Service/TGB, port container, route, node security group và pod có listen
  trên đúng port.
- `Target.ResponseCodeMismatch`: ALB đã tới được pod nhưng application trả status ngoài matcher.
  Curl trực tiếp qua Service và xem application log.
- `Target.NotRegistered`: TGB chưa reconcile hoặc service/port name không khớp.
- `Target.FailedHealthChecks`: kiểm tra health check path và readiness của application.

Dashboard dùng target port `3000`; hub proxy dùng port `8000`. Không mở rộng CIDR public chỉ để
khắc phục health check; traffic ALB → node phải dùng security group reference.

## Rollout image an toàn

1. Build image từ repository root theo hướng dẫn trong [`scripts/README.md`](../scripts/README.md).
2. Push tag immutable vào ECR.
3. Cập nhật image tag trong `terraform.tfvars` của stack tương ứng.
4. Chạy `terraform plan` và review chỉ thay đổi image.
5. Apply stack, theo dõi rollout và health check.
6. Giữ tag cũ để rollback.

Hub image và dashboard image có quy trình riêng trong [`docs/DEPLOYMENT.md`](DEPLOYMENT.md).
Không xóa image đang được deployment hoặc rollback sử dụng.

Rollback application:

```bash
# Cập nhật tag đã biết tốt trong terraform.tfvars trước
terraform -chdir=terraform/stacks/03-hub-app plan
terraform -chdir=terraform/stacks/03-hub-app apply

terraform -chdir=terraform/stacks/04-dashboard plan
terraform -chdir=terraform/stacks/04-dashboard apply
```

Không dùng `kubectl edit` làm thay đổi lâu dài; nếu cần emergency patch, ghi lại thay đổi và đồng bộ
lại Terraform ngay sau đó.

## JupyterHub operations

```bash
kubectl -n hub get pods,svc,configmap,secret,targetgroupbinding
kubectl -n hub get deployment hub -o wide
kubectl -n hub rollout restart deployment/hub
kubectl -n hub rollout status deployment/hub --timeout=300s
```

Chỉ restart khi đã xem log và hiểu ảnh hưởng. Sau restart kiểm tra:

```bash
curl -sS -o /dev/null -w '%{http_code}\n' \
  https://notebook.mlbox.june8th.me/hub/login
kubectl -n hub get targetgroupbinding
```

Hub hiện bật CPU profile; GPU profiles vẫn tắt (`enable_gpu_profiles=false`). Không bật profile GPU
trước khi stack `99-unverified-gpu` và image GPU sẵn sàng.

## Dashboard operations

```bash
kubectl -n dashboard get deployment,service,targetgroupbinding,pods
kubectl -n dashboard rollout status deployment/dashboard --timeout=300s
kubectl -n dashboard logs deployment/dashboard --tail=100
curl -i https://mlbox.june8th.me/
curl -i https://mlbox.june8th.me/login
```

Các chức năng hiện có mức độ hoàn thiện khác nhau:

- Login/register/confirm đã gọi Cognito qua BFF; cần test với user thật sau khi redeploy.
- BFF verify JWT, mã hóa session cookie và proxy list/start/stop tới JupyterHub; readiness chỉ đạt
  khi Secret, remote state và Hub service token đã được cấu hình.
- Sandboxes đã dùng API thật cho list/start/stop; `/sandboxes/new`, rename, account và usage vẫn là
  scaffold/mock.

Không dùng dashboard làm nguồn sự thật cho quota cho đến khi usage API thật được triển khai. Khi
điều tra sandbox, đối chiếu dashboard với Hub/Kubernetes và AWS console/CLI.

## Cognito và session

Thông tin pool/client có thể lấy từ Terraform output, không hard-code secret vào source:

```bash
terraform -chdir=terraform/stacks/02-platform output
```

Dashboard client là public client, không có client secret. Khi triển khai auth thật cần kiểm tra
Cognito user pool, app client flows, callback/allowed origins và cookie/session policy. Không log
access token, refresh token, password hoặc mã OTP.

Test user dùng cho QA phải được xóa hoặc disable sau khi kiểm tra. Không đưa email/password test vào
repo hoặc tài liệu public.

## Locale và theme

Dashboard locale dùng cookie `mlbox-locale`, hỗ trợ `en` và `vi`. Kiểm tra sau khi đổi locale bằng
cách mở lại trang và xem cookie, không dùng cookie để lưu credentials.

Notebook theme được apply bằng:

```bash
./deploy/apply-hub-theme.sh
```

Script apply ConfigMap theme vào namespace `hub`, restart deployment theo mặc định và kiểm tra mount.
Sau khi đổi theme, kiểm tra cả Hub và Lab trên notebook URL. Có thể bỏ restart chỉ khi đã hiểu rằng
pod hiện tại chưa nhận ConfigMap mới.

## DNS, TLS và ALB

Route53 là authoritative DNS hiện tại cho `mlbox.june8th.me`; Cloudflare/registrar chỉ giữ vai trò
delegation/nameserver theo quy trình trong [`deploy/DNS-CLOUDFLARE.md`](../deploy/DNS-CLOUDFLARE.md).

Kiểm tra:

```bash
aws route53 list-resource-record-sets \
  --hosted-zone-id <zone-id> \
  --query "ResourceRecordSets[?contains(Name, 'mlbox.june8th.me')]"

aws acm list-certificates --region ap-southeast-2
aws elbv2 describe-listeners --load-balancer-arn <alb-arn>
```

Không tạo listener/certificate/DNS record ngoài Terraform nếu resource đó thuộc stack. Khi ACM ở
trạng thái `PENDING_VALIDATION`, dừng luồng triển khai và kiểm tra delegation/TXT record trước khi
apply stack tiếp theo.

## Terraform state và backup

Các stack dùng remote state S3 và lock DynamoDB do `00-bootstrap` tạo. Trước thao tác state:

```bash
aws s3api list-object-versions \
  --bucket jhub-gpu-sandbox-tfstate-451058046864 \
  --prefix dev/ap-southeast-2/
aws dynamodb describe-table --table-name jhub-gpu-sandbox-tflock
```

Tên thư mục stack đã đổi; backend key cũng đổi. Trước `terraform init` ở stack mới, xác minh object
state cũ và backup/versioning. Không chạy `apply` nếu Terraform vừa khởi tạo một state rỗng. Xem phần
“Đổi tên stack và remote state” trong [`docs/DEPLOYMENT.md`](DEPLOYMENT.md).

Không chạy `terraform force-unlock` nếu chưa xác định lock owner. Không xóa bucket state, lock table
hoặc version cũ trong khi còn workload.

## Chi phí và dừng lab

Đây là lab có chi phí EKS, NAT, node, EBS, RDS và ALB. Khi không dùng:

- Dừng workload/user server trước.
- Kiểm tra node và volume còn tồn tại.
- Nếu cần tạm dừng dài ngày, dùng quy trình destroy có kiểm soát, giữ remote state.
- Destroy theo thứ tự `04-dashboard` → `03-hub-app` → `02-platform` → `01-foundation`.
- Không destroy `00-bootstrap` trước khi backup toàn bộ state.

Luôn chạy `terraform plan` trước destroy và lưu plan/output phục vụ khôi phục.

## Incident checklist

1. Ghi thời điểm, URL, status code, stack/image tag và thay đổi gần nhất.
2. Xác định lỗi nằm ở DNS/TLS, ALB target, Kubernetes service/pod hay application.
3. Chụp lại `kubectl get`, `describe`, events, logs và `describe-target-health`.
4. Rollback image hoặc Terraform thay đổi gần nhất nếu có bản known-good.
5. Không xóa resource/state để “dọn lỗi” khi chưa có backup.
6. Sau khi phục hồi, cập nhật [`TODO.md`](../TODO.md) và tài liệu nếu phát hiện gap mới.

## Giới hạn đã biết

- Login/register/confirm/logout và sandbox list/start/stop đã có code thật, nhưng chưa end-to-end với Cognito/JupyterHub vì chưa có test user.
- GPU quota chưa được cấp; GPU stack và GPU profiles chưa bật.
- Chưa có monitoring/alerting/CI-CD/backup automation hoàn chỉnh.
