variable "cluster_name" { type = string }
variable "domain" {
  description = "Root domain (e.g. example.com). Hub lives at hub.<domain>."
  type        = string
}
variable "route53_zone_id" {
  description = "Existing zone. Leave empty to create a new zone (NS records must be set at the registrar)."
  type        = string
  default     = ""
}
variable "vpc_id" { type = string }
variable "oidc_provider" { type = string }
variable "oidc_provider_arn" { type = string }
variable "lb_controller_chart_version" {
  description = "aws-load-balancer-controller chart. Default = latest verified release."
  type        = string
  default     = "3.6.0" # verified 2026-10-12
}
variable "alb_dns_name" {
  description = "DNS of the ALB created by the Ingress. Empty = record not created yet; fill it in and apply a second time."
  type        = string
  default     = ""
}
variable "tags" { type = map(string) }
