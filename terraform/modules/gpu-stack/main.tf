# GPU stack shared L4 — NO MIG (temporary decision).
# Time-slicing scoped by node label so the dedicated pool is unaffected.
# The values/ConfigMap field names MUST be cross-checked against the device-plugin chart in use;
# don't infer from this file. Config format:
#   version: v1 / sharing.timeSlicing.renameByDefault / failRequestsGreaterThanOne / resources[replicas]

# The namespace has to exist before the ConfigMap and the Helm releases are applied.
# On a fresh cluster only the Helm chart creates it, but the ConfigMap is applied
# first, so the namespace is created here explicitly.
resource "kubectl_manifest" "namespace" {
  yaml_body = yamlencode({
    apiVersion = "v1"
    kind       = "Namespace"
    metadata = {
      name = var.namespace
    }
  })
}

resource "kubectl_manifest" "timeslicing_config" {
  yaml_body = templatefile("${path.module}/manifests/timeslicing-config.yaml", {
    replicas = var.gpu_shared_replicas_l4
    namespace = var.namespace
  })

  depends_on = [kubectl_manifest.namespace]
}

resource "helm_release" "device_plugin" {
  name             = "nvdp"
  namespace        = var.namespace
  create_namespace = true
  repository       = "https://nvidia.github.io/k8s-device-plugin"
  chart            = "nvidia-device-plugin"
  version          = var.device_plugin_chart_version

  # The device plugin reads the time-slicing ConfigMap; applies only to nodes labeled
  # nvidia.com/device-plugin.config=time-slicing-shared (set via the Karpenter NodePool
  # gpu-shared-l4 or kubectl label — verify the label key per chart version).
  # Chart 0.20.1 reads top-level `config` (not under `devicePlugin`). Nodes without the label
  # fall back to `default` = "none" (no sharing) so dedicated GPU nodes keep a whole GPU.
  #
  # The plugin must run on BOTH GPU pools: the shared one (time-slicing) and the dedicated one
  # (whole GPU). Pinning it to tier=shared left dedicated nodes without nvidia.com/gpu, so every
  # GPU pod there failed with "Insufficient nvidia.com/gpu". The chart's default affinity
  # (nvidia.com/gpu.present=true) already restricts the DaemonSet to GPU nodes, so only the
  # tolerations for the tier taints are needed here.
  values = [yamlencode({
    config = {
      name    = "time-slicing-shared"
      default = "none"
    }
    tolerations = [
      { key = "tier", operator = "Equal", value = "shared", effect = "NoSchedule" },
      { key = "tier", operator = "Equal", value = "dedicated", effect = "NoSchedule" },
    ]
  })]

  depends_on = [kubectl_manifest.timeslicing_config]
}

# DCGM exporter: GPU metrics + Xid errors -> auto cordon/clean nodes (§9).
resource "helm_release" "dcgm_exporter" {
  count            = var.enable_dcgm_exporter ? 1 : 0
  name             = "dcgm-exporter"
  namespace        = var.namespace
  create_namespace = true
  repository       = "https://nvidia.github.io/dcgm-exporter/helm-charts"
  chart            = "dcgm-exporter"
  version          = var.dcgm_exporter_chart_version != "" ? var.dcgm_exporter_chart_version : null

  values = [yamlencode({
    serviceMonitor = { enabled = false } # no Prometheus operator CRDs in this cluster yet; set true once installed
    nodeSelector   = { "tier" = "shared" }
    tolerations = [
      { key = "tier", operator = "Equal", value = "shared", effect = "NoSchedule" }
    ]
  })]
}
