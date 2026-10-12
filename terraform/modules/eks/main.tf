module "eks" {
  source  = "terraform-aws-modules/eks/aws"
  version = "~> 20.8"

  cluster_name    = var.cluster_name
  cluster_version = var.cluster_version

  cluster_endpoint_public_access = true

  enable_cluster_creator_admin_permissions = true
  enable_irsa                              = true # tương thích Pod Identity agent bên dưới

  vpc_id     = var.vpc_id
  subnet_ids = var.subnet_ids

  # IP prefix delegation: bắt buộc khi scale hàng nghìn pod (mục 4 doc handoff).
  # Tên field phải đối chiếu doc EKS/VPC-CNI hiện hành theo cluster_version.
  cluster_addons = {
    coredns    = { most_recent = true }
    kube-proxy = { most_recent = true }
    vpc-cni = {
      most_recent    = true
      before_compute = true
      configuration_values = jsonencode({
        env = {
          ENABLE_PREFIX_DELEGATION = "true"
          WARM_PREFIX_TARGET       = "1"
        }
      })
    }
    # Key PHẢI là tên addon thật của EKS (key "ebs-csi" khiến API trả empty).
    aws-ebs-csi-driver = {
      most_recent              = true
      service_account_role_arn = aws_iam_role.ebs_csi.arn
    }
    eks-pod-identity-agent = {
      most_recent    = true
      before_compute = true
    }
  }

  eks_managed_node_groups = {
    system = {
      ami_type       = "AL2023_x86_64_STANDARD"
      instance_types = var.system_instance_types
      min_size       = 2
      max_size       = 4
      desired_size   = 2
      # KHÔNG taint pool system: pod addon EKS (coredns, ebs-csi) không tolerate
      # được taint custom nên sẽ Pending khiến addon DEGRADED. User pod đã bị chặn
      # khỏi node system bằng nodeSelector trong hub profileList (tier=shared/dedicated/cpu-user).
      labels = { tier = "system" }
    }
  }

  tags = var.tags
}
