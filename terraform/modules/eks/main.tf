module "eks" {
  source  = "terraform-aws-modules/eks/aws"
  version = "~> 20.8"

  cluster_name    = var.cluster_name
  cluster_version = var.cluster_version

  cluster_endpoint_public_access = true

  enable_cluster_creator_admin_permissions = true
  enable_irsa                              = true # for Pod Identity agent compatibility below

  vpc_id     = var.vpc_id
  subnet_ids = var.subnet_ids

  # Tag so Karpenter can discover the SG for nodes (EC2NodeClass securityGroupSelectorTerms).
  node_security_group_tags = {
    "karpenter.sh/discovery" = var.cluster_name
  }

  # IP prefix delegation: mandatory when scaling to thousands of pods (handoff doc §4).
  # Field names must be cross-checked against the current EKS/VPC-CNI docs for the cluster_version.
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
    # Key MUST be the real EKS addon name (key "ebs-csi" makes the API return empty).
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
      # Do NOT taint the system pool: EKS addon pods (coredns, ebs-csi) can't tolerate
      # custom taints, so they'd go Pending and the addons would be DEGRADED. User pods are
      # kept off system nodes via nodeSelector in the hub profileList (tier=shared/dedicated/cpu-user).
      labels = { tier = "system" }
    }
  }

  tags = var.tags
}
