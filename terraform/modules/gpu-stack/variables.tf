variable "cluster_name" { type = string }
variable "region" { type = string }

variable "device_plugin_chart_version" {
  description = "Chart nvidia-device-plugin. Mặc định = release mới nhất đã verify."
  type        = string
  default     = "0.20.1" # verify 2026-10-12 (release 2026-09-22)
}

variable "dcgm_exporter_chart_version" {
  description = "Chart dcgm-exporter (repo https://nvidia.github.io/dcgm-exporter/helm-charts)."
  type        = string
  default     = "4.8.4" # verify 2026-10-12, appVersion 4.8.4
}

variable "enable_dcgm_exporter" {
  description = "Bật DCGM exporter để theo dõi lỗi Xid + metric GPU (mục 9 doc)."
  type        = bool
  default     = true
}

variable "gpu_shared_replicas_l4" {
  description = "replicas time-slicing L4 @ commit 8GB factor 1.0. L4 24GB -> 3."
  type        = number
  default     = 3
}

variable "namespace" {
  description = "Namespace cài device plugin."
  type        = string
  default     = "gpu-operator-resources"
}

variable "tags" { type = map(string) }
