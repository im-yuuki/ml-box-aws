output "dashboard_ecr_url" {
  description = "ECR repository URL for the dashboard image."
  value       = aws_ecr_repository.this["dashboard"].repository_url
}

output "bff_ecr_url" {
  description = "ECR repository URL for the BFF image."
  value       = aws_ecr_repository.this["bff"].repository_url
}

output "dashboard_target_group_arn" {
  description = "Target group ARN for the dashboard (bound by TargetGroupBinding)."
  value       = aws_lb_target_group.dashboard.arn
}

output "dashboard_url" {
  description = "Public URL of the dashboard."
  value       = "https://${var.domain}"
}
