output "timeslicing_config_name" { value = "time-slicing-shared" }
output "shared_resource_name" { value = "nvidia.com/gpu" } # time-sliced replicas keep the standard name (renameByDefault=false)
output "namespace" { value = var.namespace }
