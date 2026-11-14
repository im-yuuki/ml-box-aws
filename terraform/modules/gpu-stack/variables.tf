variable "cluster_name" { type = string }
variable "region" { type = string }

variable "device_plugin_chart_version" {
  description = "nvidia-device-plugin chart. Default = latest verified release."
  type        = string
  default     = "0.20.1" # verified 2026-10-12 (release 2026-09-22)
}

variable "dcgm_exporter_chart_version" {
  description = "dcgm-exporter chart (repo https://nvidia.github.io/dcgm-exporter/helm-charts)."
  type        = string
  default     = "4.8.4" # verified 2026-10-12, appVersion 4.8.4
}

variable "enable_dcgm_exporter" {
  description = "Enable the DCGM exporter to track Xid errors + GPU metrics."
  type        = bool
  default     = true
}

variable "enable_dcgm_service_monitor" {
  description = "Create a ServiceMonitor for dcgm-exporter (requires Prometheus Operator CRDs, e.g. from kube-prometheus-stack)."
  type        = bool
  default     = true
}

variable "gpu_shared_replicas_l4" {
  description = "Time-slicing replicas @ 8GB commit, factor 1.0 (T4 16GB -> 2)."
  type        = number
  default     = 2
}

variable "namespace" {
  description = "Namespace to install the device plugin in."
  type        = string
  default     = "gpu-operator-resources"
}

variable "tags" { type = map(string) }
