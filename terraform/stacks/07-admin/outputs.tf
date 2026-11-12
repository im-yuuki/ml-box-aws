output "admin_url" {
  description = "URL of the admin console."
  value       = "https://${local.admin_host}"
}

output "admin_role_arn" {
  description = "Read-only IAM role assumed by the console pod through IRSA."
  value       = aws_iam_role.admin.arn
}

output "admin_target_group_arn" {
  description = "Target group ARN of the console (bound by TargetGroupBinding)."
  value       = aws_lb_target_group.admin.arn
}
