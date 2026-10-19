variable "region" {
  type    = string
  default = "ap-southeast-2"
}

variable "env" {
  type    = string
  default = "dev"
}

variable "project" {
  type    = string
  default = "jhub-gpu-sandbox"
}

variable "device_plugin_chart_version" {
  description = "nvidia-device-plugin chart. Default = latest release verified 2026-10-12 (0.20.1)."
  type        = string
  default     = "0.20.1"
}

variable "dcgm_exporter_chart_version" {
  type    = string
  default = "4.8.4" # verify 2026-10-12
}

variable "gpu_shared_replicas_l4" {
  description = "time-slicing replicas for L4 @ commit 8GB, factor 1.0."
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
