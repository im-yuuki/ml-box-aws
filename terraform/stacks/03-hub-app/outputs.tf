output "hub_host" {
  description = "Public hostname of the JupyterHub."
  value       = local.hub_host
}

output "hub_url" {
  description = "Full URL of the JupyterHub."
  value       = "https://${local.hub_host}"
}

output "https_listener_arn" {
  description = "ARN of the ALB HTTPS listener (04-dashboard adds host-header rules/certs here)."
  value       = aws_lb_listener.https.arn
}
