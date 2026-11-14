# GPU stack shared L4 — NO MIG (temporary decision).
# Time-slicing scoped by node label so the dedicated pool is unaffected.
# The values/ConfigMap field names MUST be cross-checked against the device-plugin chart in use;
# don't infer from this file. Config format:
#   version: v1 / sharing.timeSlicing.renameByDefault / failRequestsGreaterThanOne / resources[replicas]

# Namespace for the GPU operator resources. This resource existed in state but was
# dropped from the module at some point, so plans wanted to destroy the namespace
# holding nvdp and dcgm-exporter. Keep it managed here to avoid that.
resource "kubectl_manifest" "namespace" {
  yaml_body = <<-EOT
    apiVersion: v1
    kind: Namespace
    metadata:
      name: ${var.namespace}
  EOT
}

resource "kubectl_manifest" "timeslicing_config" {
  yaml_body = templatefile("${path.module}/manifests/timeslicing-config.yaml", {
    replicas = var.gpu_shared_replicas_l4
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
    serviceMonitor = { enabled = var.enable_dcgm_service_monitor } # requires the kube-prometheus-stack (Prometheus Operator CRDs) to be installed first
    customMetrics  = <<-EOT
      # MLBox counters: the chart default set + Xid errors. Custom metrics are a complete
      # replacement for the default CSV, so keep this list complete.
      DCGM_FI_DEV_DEC_UTIL, gauge, Decoder utilization (in %).
      DCGM_FI_DEV_ENC_UTIL, gauge, Encoder utilization (in %).
      DCGM_FI_DEV_FB_FREE, gauge, Framebuffer memory free (in MiB).
      DCGM_FI_DEV_FB_USED, gauge, Framebuffer memory used (in MiB).
      DCGM_FI_DEV_GPU_TEMP, gauge, GPU temperature (in C).
      DCGM_FI_DEV_GPU_UTIL, gauge, GPU utilization (in %).
      DCGM_FI_DEV_MEMORY_TEMP, gauge, Memory temperature (in C).
      DCGM_FI_DEV_MEM_CLOCK, gauge, Memory clock frequency (in MHz).
      DCGM_FI_DEV_MEM_COPY_UTIL, gauge, Memory utilization (in %).
      DCGM_FI_DEV_PCIE_REPLAY_COUNTER, counter, Total number of PCIe retries.
      DCGM_FI_DEV_POWER_USAGE, gauge, Power draw (in W).
      DCGM_FI_DEV_SM_CLOCK, gauge, SM clock frequency (in MHz).
      DCGM_FI_DEV_TOTAL_ENERGY_CONSUMPTION, counter, Total energy consumption since the driver was last reloaded (in mJ).
      DCGM_FI_DEV_VGPU_LICENSE_STATUS, gauge, vGPU License status
      DCGM_FI_DEV_XID_ERRORS, gauge, Value of the last XID error encountered.
      DCGM_FI_PROF_DRAM_ACTIVE, gauge, Ratio of cycles the device memory interface is active sending or receiving data.
      DCGM_FI_PROF_GR_ENGINE_ACTIVE, gauge, Ratio of time the graphics engine is active.
      DCGM_FI_PROF_PCIE_RX_BYTES, gauge, The rate of data received over the PCIe bus - including both protocol headers and data payloads - in bytes per second.
      DCGM_FI_PROF_PCIE_TX_BYTES, gauge, The rate of data transmitted over the PCIe bus - including both protocol headers and data payloads - in bytes per second.
      DCGM_FI_PROF_PIPE_TENSOR_ACTIVE, gauge, Ratio of cycles the tensor (HMMA) pipe is active.
    EOT
    # GPU nodes of both tiers only: nodeSelector is single-valued, so use affinity.
    # (CPU-only system nodes have no NVML and the pod CrashLoops there.)
    affinity = {
      nodeAffinity = {
        requiredDuringSchedulingIgnoredDuringExecution = {
          nodeSelectorTerms = [{
            matchExpressions = [{
              key      = "tier"
              operator = "In"
              values   = ["shared", "dedicated"]
            }]
          }]
        }
      }
    }
    tolerations = [
      { key = "tier", operator = "Equal", value = "shared", effect = "NoSchedule" },
      { key = "tier", operator = "Equal", value = "dedicated", effect = "NoSchedule" },
    ]
  })]
}
