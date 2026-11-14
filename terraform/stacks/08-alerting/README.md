# 08-alerting — SNS, IRSA roles, CloudWatch alarms, `/mlbox` log group

Alerting + centralized logs cho cả cụm. Stack không tạo VPC, EKS, RDS hay ALB mới; chỉ đọc remote state của
`02-platform` (ARNs của ALB + RDS) và `04-dashboard`.

## Phụ thuộc

```text
00-bootstrap → 01-foundation → 02-platform → 03-hub-app → 04-dashboard → 08-alerting
```

Không có giá trị bắt buộc trong `terraform.tfvars` — mặc định đúng cho tài khoản lab (xem
`terraform.tfvars.example`). Trust anchor của IRSA (OIDC provider ARN + issuer host) được đọc từ cụm
đang chạy và IAM OIDC provider lúc `plan`, nên không cần đồng bộ tay khi cluster được dựng lại.

## Tài nguyên

- SNS topic `…-mlbox-alerts` (mã hoá `alias/aws/sns`). Subscription (email) tạo thủ công — cần click
  xác nhận, stack không tự đăng ký.
- Log group `/mlbox`, retention 30 ngày (Fluent Bit ship log vào đây; export audit qua CronJob
  `monitoring/audit-export-cronjob.yaml`).
- IRSA role `…-alertmanager`: chỉ `SNS:Publish` vào topic trên (`system:serviceaccount:monitoring:kube-prometheus-stack-alertmanager`).
- IRSA role `…-fluent-bit`: chỉ tạo/ghi/đọc stream trong `/mlbox` (`system:serviceaccount:amazon-cloudwatch:aws-fluent-bit-aws-for-fluent-bit`).
- 9 CloudWatch metric alarms (hub/dashboard target-group unhealthy, ALB 5xx, RDS CPU/connections/memory
  cho cả hub và usage) — tất cả nối vào SNS topic.

## Cách apply

```bash
terraform init -reconfigure -backend-config=backend.hcl   # 00-bootstrap sinh sẵn backend.hcl
terraform plan
terraform apply
```

Sau apply: annotate các ServiceAccount theo output (`alertmanager_role_arn`, `fluent_bit_role_arn`),
rồi restart deployment/statefulset tương ứng. Chi tiết values Helm và verify/rollback:
[`monitoring/README.md`](../../../monitoring/README.md) và [`docs/DEPLOYMENT.md`](../../../docs/DEPLOYMENT.md) mục 13.

Kiểm tra sau khi apply:

```bash
aws sns list-subscriptions-by-topic --topic-arn "$(terraform output -raw sns_alerts_topic_arn)"
aws cloudwatch describe-alarms --alarm-name-prefix jhub-gpu-sandbox-dev-apse2- --query 'MetricAlarms[].StateValue'
aws logs describe-log-groups --log-group-name-prefix /mlbox
```

Rollback: xoá subscription SNS (nếu tạo), rồi `terraform destroy` (xoá alarms, SNS topic, log group, IRSA roles).
