# Sandbox file storage (EFS). Split from 02-platform so it can be applied and reviewed on its own.
locals {
  region_short = replace(var.region, "ap-southeast-", "apse") # keep in sync with 01-foundation naming
  cluster_name = "${var.project}-${var.env}-${local.region_short}"
  oidc_issuer  = data.aws_eks_cluster.core.identity[0].oidc[0].issuer
}

data "aws_eks_cluster" "core" {
  name = local.cluster_name
}

data "aws_vpc" "core" {
  id = data.aws_eks_cluster.core.vpc_config[0].vpc_id
}

data "aws_subnets" "private" {
  filter {
    name   = "vpc-id"
    values = [data.aws_vpc.core.id]
  }
  filter {
    name   = "tag:kubernetes.io/role/internal-elb"
    values = ["1"]
  }
}

data "aws_iam_openid_connect_provider" "eks" {
  url = local.oidc_issuer
}

provider "aws" {
  region = var.region
  default_tags { tags = var.tags }
}

provider "kubectl" {
  host                   = data.aws_eks_cluster.core.endpoint
  cluster_ca_certificate = base64decode(data.aws_eks_cluster.core.certificate_authority[0].data)
  load_config_file       = false
  exec {
    api_version = "client.authentication.k8s.io/v1beta1"
    command     = "aws"
    args        = ["eks", "get-token", "--cluster-name", local.cluster_name, "--region", var.region]
  }
}

module "efs_storage" {
  source = "../../modules/efs-storage"

  cluster_name       = local.cluster_name
  vpc_id             = data.aws_vpc.core.id
  vpc_cidr           = data.aws_vpc.core.cidr_block
  private_subnet_ids = data.aws_subnets.private.ids
  oidc_provider_arn  = data.aws_iam_openid_connect_provider.eks.arn
  oidc_issuer_host   = replace(local.oidc_issuer, "https://", "")
  tags               = var.tags
}
