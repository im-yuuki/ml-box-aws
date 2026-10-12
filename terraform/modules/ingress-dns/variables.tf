variable "cluster_name" { type = string }
variable "domain" {
  description = "Domain gốc (VD example.com). Hub ở hub.<domain>."
  type        = string
}
variable "route53_zone_id" {
  description = "Zone có sẵn. Để trống = tạo zone mới (phải trỏ NS ở registrar)."
  type        = string
  default     = ""
}
variable "vpc_id" { type = string }
variable "oidc_provider" { type = string }
variable "oidc_provider_arn" { type = string }
variable "lb_controller_chart_version" {
  description = "Chart aws-load-balancer-controller. Mặc định = release mới nhất đã verify."
  type        = string
  default     = "3.6.0" # verify 2026-10-12
}
variable "tags" { type = map(string) }
