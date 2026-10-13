variable "region" {
  type    = string
  default = "ap-southeast-2"
}
variable "cluster_name" { type = string }
variable "cluster_endpoint" { type = string }
variable "cluster_ca_data" { type = string }

# Từ output stack 01 (copy tay, xem README stack 01).
variable "vpc_id" { type = string }
variable "private_subnet_ids" { type = list(string) }
variable "node_security_group_id" { type = string }
variable "oidc_provider" { type = string }
variable "oidc_provider_arn" { type = string }

variable "domain" {
  description = "Domain gốc (VD example.com). Hub ở hub.<domain>."
  type        = string
}
variable "route53_zone_id" {
  description = "Zone có sẵn. Để trống = tạo zone mới (phải trỏ NS ở registrar)."
  type        = string
  default     = ""
}
variable "cognito_domain_prefix" {
  description = "Prefix hosted UI Cognito (unique theo region)."
  type        = string
}
variable "alb_dns_name" {
  description = "DNS ALB từ Ingress (kubectl get ingress -n hub). Apply lần 2."
  type        = string
  default     = ""
}

variable "z2jh_chart_version" {
  description = "Chart jupyterhub (Z2JH). Mặc định = release mới nhất đã verify."
  type        = string
  default     = "4.4.2" # verify 2026-10-12 (release 2026-09-01)
}

variable "cpu_image" {
  description = "Image CPU. Mặc định image public để lab; pin ECR sau khi có CI."
  type        = string
  default     = "jupyter/base-notebook:latest"
}
variable "gpu_image" {
  description = "Image GPU. Mặc định image public để lab; pin ECR sau khi có CI."
  type        = string
  default     = "quay.io/jupyter/pytorch-notebook:cuda12-latest"
}

variable "vram_commit_mib" {
  type    = number
  default = 8192
}
variable "vram_ceiling_mib" {
  type    = number
  default = 12288
}

variable "tags" {
  type = map(string)
  default = {
    Project     = "jhub-gpu-sandbox"
    Environment = "dev"
    ManagedBy   = "terraform"
  }
}
