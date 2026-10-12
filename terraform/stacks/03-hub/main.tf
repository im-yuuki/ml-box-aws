# Stack 03-hub: helm_release jupyterhub từ hub-values.yaml.tpl + extraConfig spawn hook.
# Phụ thuộc: stack 01 (cluster), stack 02 (gpu.shared), module hub-db/auth/storage (chưa scaffold).
# Auth Cognito/OIDC + RDS + S3 workspace là bước tiếp theo sau khi chốt mục 12.

# resource "helm_release" "jupyterhub" {
#   name             = "jupyterhub"
#   namespace        = "hub"
#   create_namespace = true
#   repository       = "https://hub.jupyter.org/helm-chart/"
#   chart            = "jupyterhub"
#   version          = var.z2jh_chart_version
#   values = [templatefile("${path.module}/values/hub-values.yaml.tpl", {
#     hub_db_url = var.hub_db_url
#     cpu_image  = var.cpu_image
#     gpu_image  = var.gpu_image
#   })]
# }
# TODO: uncomment khi đã có hub-db + auth. Tên field values đối chiếu chart version.
