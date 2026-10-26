variable "region" {
  type    = string
  default = "ap-southeast-2"
}

variable "env" {
  type    = string
  default = "dev"
}

variable "project" {
  # Keep in sync with 01-foundation's cluster_name + env defaults
  # (cluster name = <project>-<env>-<apseN>).
  type    = string
  default = "jhub-gpu-sandbox"
}

variable "domain" {
  description = "Root domain (e.g. example.com). Hub lives at notebook.<domain>, dashboard at the apex."
  type        = string
}

variable "cognito_domain_prefix" {
  description = "Cognito hosted-UI prefix (unique per region)."
  type        = string
}

variable "manage_route53" {
  description = "Manage A-alias records in the Route53 zone created by 00-bootstrap."
  type        = bool
  default     = true
}

variable "route53_zone_id" {
  description = "Deprecated compatibility input; the zone ID is discovered by project tags from 00-bootstrap."
  type        = string
  default     = ""
}

variable "proxy_port" {
  description = <<-EOT
    Port the Z2JH configurable proxy listens on (HTTP: 8000), used in ALB/node
    security-group rules. TargetGroupBinding resolves proxy-public:80 to this
    target port; the TG's default port is separately configured as 8081.
  EOT
  type        = number
  default     = 8000
}

variable "lb_controller_chart_version" {
  description = "aws-load-balancer-controller chart (dùng bởi module ingress-dns)."
  type        = string
  default     = "3.6.0" # verified 2026-10-12
}

variable "tags" {
  type = map(string)
  default = {
    Project     = "jhub-gpu-sandbox"
    Environment = "dev"
    ManagedBy   = "terraform"
  }
}
