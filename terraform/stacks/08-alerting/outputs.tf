output "sns_alerts_topic_arn" {
  description = "ARN of the MLBox alerts SNS topic. Subscribe manually (email confirmation) then publish a test message."
  value       = aws_sns_topic.alerts.arn
}

output "alertmanager_role_arn" {
  description = "IRSA role to annotate the Alertmanager service account (monitoring/kube-prometheus-stack-alertmanager)."
  value       = aws_iam_role.alertmanager.arn
}

output "fluent_bit_role_arn" {
  description = "IRSA role to annotate the Fluent Bit service account (amazon-cloudwatch/aws-for-fluent-bit)."
  value       = aws_iam_role.fluent_bit.arn
}

output "mlbox_log_group" {
  description = "Centralized CloudWatch Logs group for app logs (retention 30d)."
  value       = aws_cloudwatch_log_group.mlbox.arn
}
