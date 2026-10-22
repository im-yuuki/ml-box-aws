variable "cluster_name" { type = string }
variable "domain" {
  description = "Root domain (e.g. example.com). Notebook (JupyterHub) lives at notebook.<domain>, dashboard at the apex."
  type        = string
}
variable "vpc_id" { type = string }
variable "oidc_provider" { type = string }
variable "oidc_provider_arn" { type = string }
variable "lb_controller_chart_version" {
  description = "aws-load-balancer-controller chart. Default = latest verified release."
  type        = string
  default     = "3.6.0" # verified 2026-10-12
}
variable "tags" { type = map(string) }

# --- ALB (created by this module) ---

variable "subnet_ids" {
  description = "Public subnets for the internet-facing ALB. At least 2, in different AZs."
  type        = list(string)
  validation {
    condition     = length(var.subnet_ids) >= 2
    error_message = "The ALB needs at least 2 public subnets in different AZs."
  }
}

variable "node_security_group_id" {
  description = "EKS node security group. Also the SG the hub pods sit behind (VPC CNI primary ENI)."
  type        = string
}

variable "proxy_port" {
  description = "Port the JupyterHub configurable HTTP proxy pod listens on (Z2JH proxy HTTP: 8000); used for ALB/node security-group rules."
  type        = number
  default     = 8000
  validation {
    condition     = var.proxy_port > 0 && var.proxy_port <= 65535
    error_message = "proxy_port must be a valid TCP port."
  }
}

variable "target_group_port" {
  description = "Default port for the ALB target group. TargetGroupBinding may register each endpoint with its resolved Service targetPort instead."
  type        = number
  default     = 8081
  validation {
    condition     = var.target_group_port > 0 && var.target_group_port <= 65535
    error_message = "target_group_port must be a valid TCP port."
  }
}

variable "health_check_path" {
  description = "HTTP path the ALB health check requests on the hub pods."
  type        = string
  default     = "/"
  validation {
    condition     = startswith(var.health_check_path, "/")
    error_message = "health_check_path must start with '/'."
  }
}

# --- DNS ---

variable "manage_route53" {
  description = "true = the zone lives in Route53 (Terraform manages the ACM TXT + the A-alias record). false = DNS is managed manually (Cloudflare): Terraform creates no Route53 resource and only outputs the ACM TXT record to publish."
  type        = bool
  default     = false
}

variable "route53_zone_id" {
  description = "Existing Route53 zone. Only used when manage_route53 = true. Leave empty to create a new zone (NS records must be set at the registrar)."
  type        = string
  default     = ""
}

variable "validate_certificate" {
  description = "true = also create aws_acm_certificate_validation, which blocks the apply until ACM issued the certificate. Needs the zone to be already authoritative (NS delegation done), otherwise the apply waits for the full timeout."
  type        = bool
  default     = false
}
