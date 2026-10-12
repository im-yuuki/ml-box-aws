output "vpc_id" { value = module.network.vpc_id }
output "private_subnet_ids" { value = module.network.private_subnet_ids }
output "public_subnet_ids" { value = module.network.public_subnet_ids }
output "cluster_name" { value = module.eks.cluster_name }
output "cluster_endpoint" { value = module.eks.cluster_endpoint }
output "karpenter_namespace" { value = module.karpenter.namespace }
output "vram_commit_mib" { value = var.vram_commit_mib }
output "vram_ceiling_mib" { value = var.vram_ceiling_mib }
