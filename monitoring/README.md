# MLBox Monitoring

> Cập nhật 2026-11-14 (lần 2). Áp dụng cho cluster ap-southeast-2.

## Cấu trúc

- **kube-prometheus-stack** (chart 45.12.0, app v0.63.0) — namespace `monitoring`, values `monitoring/kube-prometheus-stack-values.yaml` (Grafana off).
- **Alertmanager** route tất cả alerts → SNS topic `jhub-gpu-sandbox-dev-apse2-mlbox-alerts` qua IRSA `jhub-gpu-sandbox-dev-apse2-alertmanager` (namespace `monitoring`, SA `kube-prometheus-stack-alertmanager`).
- **PrometheusRule** `gpu-alerts` (`monitoring/gpu-alerts-rules.yaml`): `GpuMemoryHigh`, `GpuXidError`, `GpuMetricsMissing`, `GpuNodeNotReady`, `GpuNodeChurn` — đã load và evaluate OK.
- **PrometheusRule** `crashloop-alerts` (`monitoring/crashloop-rules.yaml`): `PodCrashLooping` (2 restarts/10m).
- **Stack `terraform/stacks/08-alerting`** (đã apply): SNS topic, IRSA roles (alertmanager, fluent-bit), log group `/mlbox` (retention 30d), 9 CloudWatch alarms (ALB hub/dashboard unhealthy + 5xx + RDS hub/usage CPU/connections/freeable memory) — tất cả → SNS, tất cả trạng thái OK (kiểm 2026-11-14).

## Trạng thái subscription SNS (2026-11-14)

- **Đã xác nhận**: `me@june8th.eu.org` → topic `…-mlbox-alerts`, `PendingConfirmation=false` (kiểm lại bằng `sns get-subscription-attributes`). Alert giờ tới được email.

## Verify bằng chứng 2026-11-14

- dcgm-exporter (stack 05-gpu, nodeaffinity tier shared|dedicated, serviceMonitor on): GPU metrics xuất hiện khi có GPU node (`g4dn.xlarge`): `DCGM_FI_DEV_GPU_UTIL`, `DCGM_FI_DEV_FB_USED`, `DCGM_FI_DEV_MEM_COPY_UTIL`... qua pod `gpu-smoke`.
- Alertmanager firing cảnh báo thật (2026-11-14 16:27): SNS `NumberOfMessagesPublished` = 1.0 @ 16:27, `NumberOfNotificationsFailed` = rỗng. Lúc đó topic chưa có subscriber; subscription đã được xác nhận sau đó.

## Gotchas (đã mất thời gian khắc phục)

- Alertmanager `sns_configs` trong chart 45.12.0 (Alertmanager 0.25.0): **KHÔNG** dùng `api_url` — nó làm IRSA lỗi "AssumeRoleWithWebIdentity ... version 2011-06-15". Không cần field vùng; SDK dùng `AWS_REGION`.
- Alertmanager 0.25: từ khoá `api_url` hợp lệ cho SNS khi dùng static creds; IRSA cần KHÔNG có `api_url`.
- `routes` trong config chart bị deep-merge với default: phải định nghĩa `routes: []` (hoặc route con) + null receiver tường minh, nếu không lỗi `undefined receiver "null"`.
- Custom metrics cho dcgm-exporter là **thay thế toàn bộ**, không additive; `DCGM_FI_DEV_XID_ERRORS` chỉ xuất hiện khi Xid đã xảy ra (gauge, blank values bị skip).
- Khi thay đổi iam cert/token hoặc SA annotation: `kubectl rollout restart statefulset/alertmanager-...` để pod nhận env/token mới (pod restart KHÔNG regenerate config nếu operator chưa reconcile - phải `helm upgrade` để operator render `-generated` secret).

## Rollback

- `helm uninstall kube-prometheus-stack aws-fluent-bit -n monitoring -n amazon-cloudwatch` (chú ý namespace khác nhau).
- `terraform -chdir=terraform/stacks/08-alerting destroy` (xoá SNS/IRSA/log group/alarms; mất log group).