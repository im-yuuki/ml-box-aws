variable "region" {
  type    = string
  default = "ap-southeast-2"
}
variable "cluster_name" { type = string }
variable "cluster_endpoint" { type = string }
variable "cluster_ca_data" { type = string }

variable "device_plugin_chart_version" {
  description = "Chart nvidia-device-plugin. Mặc định = release mới nhất đã verify."
  type        = string
  default     = "0.20.1" # verify 2026-10-12
}

variable "dcgm_exporter_chart_version" {
  type    = string
  default = "4.8.4" # verify 2026-10-12
}

variable "gpu_shared_replicas_l4" {
  description = "replicas time-slicing L4 @ commit 8GB factor 1.0."
  type        = number
  default     = 3
}

variable "tags" {
  type = map(string)
  default = {
    Project     = "jhub-gpu-sandbox"
    Environment = "dev"
    ManagedBy   = "terraform"
  }
}
