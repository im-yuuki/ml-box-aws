module "gpu_stack" {
  source = "../../modules/gpu-stack"

  cluster_name                = var.cluster_name
  region                      = var.region
  device_plugin_chart_version = var.device_plugin_chart_version
  dcgm_exporter_chart_version = var.dcgm_exporter_chart_version
  gpu_shared_replicas_l4      = var.gpu_shared_replicas_l4
  tags                        = var.tags
}
