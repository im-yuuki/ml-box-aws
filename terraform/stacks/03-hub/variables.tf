variable "region" {
  type    = string
  default = "ap-southeast-2"
}
variable "cluster_name" { type = string }
variable "cluster_endpoint" { type = string }
variable "cluster_ca_data" { type = string }

variable "z2jh_chart_version" {
  description = "Chart jupyterhub (Z2JH). Mặc định = release mới nhất đã verify."
  type        = string
  default     = "4.4.2" # verify 2026-10-12 (release 2026-09-01)
}

variable "hub_db_url" {
  description = "Postgres URL (từ Secrets Manager/RDS, không commit secret vào git)."
  type        = string
  sensitive   = true
}

variable "cpu_image" { type = string }
variable "gpu_image" { type = string }

variable "tags" {
  type = map(string)
  default = {
    Project     = "jhub-gpu-sandbox"
    Environment = "dev"
    ManagedBy   = "terraform"
  }
}
