output "timeslicing_config_name" { value = "time-slicing-shared" }
output "shared_resource_name" { value = "nvidia.com/gpu.shared" } # from renameByDefault=true
output "namespace" { value = var.namespace }
