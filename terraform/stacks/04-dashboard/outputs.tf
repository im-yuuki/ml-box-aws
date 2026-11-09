output "dashboard_target_group_arn" {
  description = "Target group ARN for the dashboard (bound by TargetGroupBinding)."
  value       = aws_lb_target_group.dashboard.arn
}

output "dashboard_url" {
  description = "Public URL of the dashboard."
  value       = "https://${var.domain}"
}
