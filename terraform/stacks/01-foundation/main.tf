locals {
  # Naming + CIDR/AZ đều suy từ region: 1 cluster mỗi region, apply 1 region/lần.
  # Dùng mã ngắn (apse2) để IAM name_prefix (giới hạn 38 ký tự) không vỡ.
  full_name = "${var.cluster_name}-${var.env}-${var.region_short[var.region]}"
  vpc_cidr  = var.vpc_cidr != "" ? var.vpc_cidr : var.region_cidrs[var.region]
  azs       = length(var.azs) > 0 ? var.azs : var.region_azs[var.region]
}

module "network" {
  source = "../../modules/network"

  name                           = local.full_name
  vpc_cidr                       = local.vpc_cidr
  azs                            = local.azs
  cluster_name                   = local.full_name
  nat_mode                       = var.nat_mode
  enable_vpc_interface_endpoints = var.enable_vpc_interface_endpoints
  fck_nat_instance_type          = var.fck_nat_instance_type
  tags                           = var.tags
}

module "eks" {
  source = "../../modules/eks"

  cluster_name          = local.full_name
  cluster_version       = var.cluster_version
  vpc_id                = module.network.vpc_id
  subnet_ids            = module.network.private_subnet_ids
  system_instance_types = var.system_instance_types
  tags                  = var.tags

  depends_on = [module.network]
}

module "karpenter" {
  source = "../../modules/karpenter"

  cluster_name            = module.eks.cluster_name
  oidc_provider           = module.eks.oidc_provider
  oidc_provider_arn       = module.eks.oidc_provider_arn
  karpenter_chart_version = var.karpenter_chart_version
  interruption_queue_name = "${local.full_name}-karpenter-interruption"
  kms_key_arn_ebs         = var.kms_key_arn_ebs
  vram_commit_mib         = var.vram_commit_mib
  vram_ceiling_mib        = var.vram_ceiling_mib
  gpu_shared_replicas_l4  = var.gpu_shared_replicas_l4
  tags                    = var.tags

  depends_on = [module.eks]
}

# Node role của Karpenter PHẢI có access entry loại EC2_LINUX, không thì kubelet
# bị 403 và node không bao giờ join (MNG thì module EKS tự lo, role custom thì không).
resource "aws_eks_access_entry" "karpenter_node" {
  cluster_name  = module.eks.cluster_name
  principal_arn = module.karpenter.node_role_arn
  type          = "EC2_LINUX"

  depends_on = [module.eks]
}
