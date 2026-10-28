# ---------------------------------------------------------------------------
# Outputs consumed by 03-hub-app and 04-dashboard. Persistent DNS/ACM metadata is
# originally owned by 00-bootstrap; these values remain stable for downstream stacks.
# Names are the contract between the two stacks - keep them stable.
# ---------------------------------------------------------------------------

# --- Database (RDS Postgres) ---
output "db_url" {
  description = "Full postgres:// URL for the hub (password percent-encoded)."
  sensitive   = true
  value       = local.db_url
}

# Dashboard usage database contract: publish identifiers only, never credentials
# or a constructed connection URL. 04-dashboard retrieves the RDS-managed secret.
output "dashboard_usage_db_address" {
  description = "Private endpoint for the optional dashboard usage-history database; null when disabled."
  value       = var.enable_dashboard_usage_history ? aws_db_instance.dashboard_usage[0].address : null
}

output "dashboard_usage_db_port" {
  description = "Port for the optional dashboard usage-history database; null when disabled."
  value       = var.enable_dashboard_usage_history ? aws_db_instance.dashboard_usage[0].port : null
}

output "dashboard_usage_db_name" {
  description = "Database name for dashboard usage history; null when disabled."
  value       = var.enable_dashboard_usage_history ? aws_db_instance.dashboard_usage[0].db_name : null
}

output "dashboard_usage_db_username" {
  description = "Master username for dashboard usage history; null when disabled."
  value       = var.enable_dashboard_usage_history ? aws_db_instance.dashboard_usage[0].username : null
}

output "dashboard_usage_db_master_secret_arn" {
  description = "ARN of the RDS-managed credential secret; null when disabled."
  value       = var.enable_dashboard_usage_history ? aws_db_instance.dashboard_usage[0].master_user_secret[0].secret_arn : null
}

# --- Cognito (oauthenticator) ---
output "cognito_issuer" {
  description = "Cognito issuer URL (GenericOAuthenticator.issuer)."
  value       = module.auth.issuer
}

output "cognito_client_id" {
  description = "Cognito app client id."
  value       = module.auth.client_id
}

output "cognito_client_secret" {
  description = "Cognito app client secret."
  sensitive   = true
  value       = module.auth.client_secret
}

output "cognito_authorize_url" {
  description = "Cognito hosted UI authorize endpoint."
  value       = module.auth.authorize_url
}

output "cognito_token_url" {
  description = "Cognito hosted UI token endpoint."
  value       = module.auth.token_url
}

output "cognito_userdata_url" {
  description = "Cognito hosted UI userInfo endpoint."
  value       = module.auth.userdata_url
}

output "cognito_user_pool_id" {
  description = "Cognito user pool ID (for dashboard NEXT_PUBLIC_COGNITO_USER_POOL_ID)."
  value       = module.auth.user_pool_id
}

output "cognito_dashboard_client_id" {
  description = "Public Cognito app client for the dashboard (SRP/OTP, no secret)."
  value       = module.auth.dashboard_client_id
}

# --- Storage (S3 workspace) ---
output "hub_role_arn" {
  description = "IRSA role of the hub SA (attaches to the hub service account in 03-hub-app)."
  value       = module.storage.hub_role_arn
}

output "bff_sessions_table_name" {
  description = "DynamoDB table name used by the dashboard BFF for refresh-token sessions."
  value       = aws_dynamodb_table.bff_sessions.name
}

output "bff_sessions_role_arn" {
  description = "IRSA role for the dashboard BFF; grants access only to its sessions table."
  value       = aws_iam_role.bff_sessions.arn
}

# --- GitHub Actions OIDC ---
output "github_oidc_provider_arn" {
  description = "IAM OIDC provider ARN used by the GitHub Actions publisher and production deployer roles."
  value       = aws_iam_openid_connect_provider.github_actions.arn
}

output "github_publisher_role_arn" {
  description = "Set GitHub Actions repository variable AWS_ECR_PUBLISH_ROLE_ARN to this value."
  value       = aws_iam_role.github_publisher.arn
}

output "github_deployer_role_arn" {
  description = "Set GitHub Actions production environment variable AWS_DEPLOY_ROLE_ARN to this value."
  value       = aws_iam_role.github_deployer.arn
}

output "github_actions_cluster_name" {
  description = "Set GitHub Actions production environment variable EKS_CLUSTER_NAME to this value."
  value       = local.cluster_name
}

# --- ECR ---
output "ecr_cpu_repo_url" {
  description = "ECR repository URL for the CPU image (jhub-gpu-sandbox/cpu)."
  value       = module.ecr.repository_urls["cpu"]
}

output "ecr_gpu_repo_url" {
  description = "ECR repository URL for the GPU image (jhub-gpu-sandbox/gpu)."
  value       = module.ecr.repository_urls["gpu"]
}

# --- ALB / target group / certificate (module ingress-dns) ---
output "alb_arn" {
  description = "ARN of the internet-facing ALB."
  value       = module.ingress_dns.alb_arn
}

output "alb_dns_name" {
  description = "ALB DNS name - target of the 'notebook' record (Route53 owns it in this project)."
  value       = module.ingress_dns.alb_dns_name
}

output "alb_security_group_id" {
  description = "Security group attached to the ALB."
  value       = module.ingress_dns.alb_security_group_id
}

output "target_group_arn" {
  description = "Target group ARN (bound by the TargetGroupBinding in 03-hub-app)."
  value       = module.ingress_dns.target_group_arn
}

output "target_group_name" {
  description = "Target group name."
  value       = module.ingress_dns.target_group_name
}

output "certificate_arn" {
  description = "ACM certificate ARN for notebook.<domain>."
  value       = module.ingress_dns.certificate_arn
}

output "apex_certificate_arn" {
  description = "ACM certificate ARN for the apex <domain> (dashboard)."
  value       = module.ingress_dns.apex_certificate_arn
}

output "apex_certificate_status" {
  description = "Apex ACM certificate status (PENDING_VALIDATION / ISSUED / ...)."
  value       = module.ingress_dns.apex_certificate_status
}

output "certificate_status" {
  description = "ACM certificate status (PENDING_VALIDATION / ISSUED / ...)."
  value       = module.ingress_dns.certificate_status
}

output "certificate_validation_records" {
  description = "Deprecated compatibility output; ACM validation records are owned by 00-bootstrap."
  value       = module.ingress_dns.certificate_validation_records
}

output "route53_zone_nameservers" {
  description = "Nameservers of the persistent Route53 zone created by 00-bootstrap."
  value       = module.ingress_dns.zone_nameservers
}

output "lb_controller_role_arn" {
  description = "IRSA role of the aws-load-balancer-controller service account."
  value       = module.ingress_dns.lb_controller_role_arn
}

# --- Auto-discovered infrastructure (handy for the next stack) ---
output "vpc_id" {
  description = "VPC id (derived from the private subnets)."
  value       = local.vpc_id
}

output "node_security_group_id" {
  description = "Security group of the EKS nodes (karpenter.sh/discovery tag)."
  value       = local.node_security_group_id
}

output "private_subnet_ids" {
  description = "Private subnets (internal-elb tag)."
  value       = local.private_subnet_ids
}

output "public_subnet_ids" {
  description = "Public subnets (elb tag) - where the ALB runs."
  value       = local.public_subnet_ids
}

output "cluster_name" {
  description = "EKS cluster name used by this stack."
  value       = local.cluster_name
}
