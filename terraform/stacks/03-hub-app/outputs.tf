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

output "bff_api_token" {
  description = "Sensitive JupyterHub service token consumed by the dashboard BFF."
  sensitive   = true
  value       = random_password.bff_api_token.result
}

output "hub_auth_bridge_token" {
  description = "Sensitive bearer token for the BFF internal handoff-redeem endpoint, consumed by the dashboard BFF."
  sensitive   = true
  value       = random_password.hub_auth_bridge_token.result
}
