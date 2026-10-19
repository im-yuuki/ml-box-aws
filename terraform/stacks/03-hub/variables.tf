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
  description = "Root domain (e.g. example.com). Hub lives at hub.<domain>."
  type        = string
}
variable "route53_zone_id" {
  description = "Existing zone. Leave empty to create a new one (then point the NS records at your registrar)."
  type        = string
  default     = ""
}
variable "cognito_domain_prefix" {
  description = "Cognito hosted-UI prefix (unique per region)."
  type        = string
}
variable "alb_dns_name" {
  description = "ALB DNS from the hub Ingress (kubectl get ingress -n hub). Fill in and re-apply for the second pass."
  type        = string
  default     = ""
}

variable "z2jh_chart_version" {
  description = "jupyterhub (Z2JH) chart. Default = latest release verified 2026-10-12 (4.4.2)."
  type        = string
  default     = "4.4.2"
}

variable "cpu_image" {
  description = "CPU image. Default: public image for the lab; pin to ECR once CI exists."
  type        = string
  default     = "jupyter/base-notebook:latest"
}
variable "gpu_image" {
  description = "GPU image. Default: public image for the lab; pin to ECR once CI exists."
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
