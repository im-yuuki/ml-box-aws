# GPU stack shared L4 — KHÔNG MIG (quyết định tạm thời).
# Time-slicing scope theo node label để pool dedicated không bị ảnh hưởng.
# Tên field values/ConfigMap PHẢI đối chiếu chart device-plugin đang dùng (mục 12 doc),
# không suy từ file này. Handoff gợi ý format:
#   version: v1 / sharing.timeSlicing.renameByDefault / failRequestsGreaterThanOne / resources[replicas]

resource "kubectl_manifest" "timeslicing_config" {
  yaml_body = templatefile("${path.module}/manifests/timeslicing-config.yaml", {
    replicas = var.gpu_shared_replicas_l4
  })
}

resource "helm_release" "device_plugin" {
  name             = "nvdp"
  namespace        = var.namespace
  create_namespace = true
  repository       = "https://nvidia.github.io/k8s-device-plugin"
  chart            = "nvidia-device-plugin"
  version          = var.device_plugin_chart_version

  # Device plugin đọc ConfigMap time-slicing; chỉ áp cho node có label
  # nvidia.com/device-plugin.config=time-slicing-shared (gắn qua Karpenter NodePool
  # gpu-shared-l4 hoặc kubectl label — verify key label theo chart version).
  values = [yamlencode({
    devicePlugin = {
      config = {
        name    = "time-slicing-shared"
        default = "any" # node không label dùng config mặc định (nguyên GPU) cho dedicated
      }
    }
    nodeSelector = {
      "tier" = "shared"
    }
    tolerations = [
      { key = "tier", operator = "Equal", value = "shared", effect = "NoSchedule" }
    ]
  })]

  depends_on = [kubectl_manifest.timeslicing_config]
}

# DCGM exporter: metric GPU + lỗi Xid -> auto cordon/dọn node (mục 9).
resource "helm_release" "dcgm_exporter" {
  count            = var.enable_dcgm_exporter ? 1 : 0
  name             = "dcgm-exporter"
  namespace        = var.namespace
  create_namespace = true
  repository       = "https://nvidia.github.io/dcgm-exporter/helm-charts"
  chart            = "dcgm-exporter"
  version          = var.dcgm_exporter_chart_version != "" ? var.dcgm_exporter_chart_version : null

  values = [yamlencode({
    serviceMonitor = { enabled = true } # Prometheus PodMonitor/operator ở stack observability
    nodeSelector   = { "tier" = "shared" }
    tolerations = [
      { key = "tier", operator = "Equal", value = "shared", effect = "NoSchedule" }
    ]
  })]
}
