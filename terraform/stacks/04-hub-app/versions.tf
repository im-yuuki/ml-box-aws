# Application stack (JupyterHub / Z2JH).
# Infra (S3, RDS, Cognito, ECR, LB controller, ALB + target group, ACM) now
# lives in 03-platform and is consumed read-only through
# data "terraform_remote_state" "platform".
# Producers from 01-foundation are resolved automatically:
#   - cluster endpoint/CA            via data "aws_eks_cluster" (naming from project-env-region)
#   - private subnets / VPC          via the subnet tags written by the network module
#   - node security group            via the karpenter.sh/discovery tag on the SG
#   - OIDC provider (IRSA)           via the IAM OpenID Connect provider list
# So nothing has to be copied from the 01-foundation outputs ever again.
terraform {
  required_version = ">= 1.6.0"
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
    helm = {
      source  = "hashicorp/helm"
      version = "~> 2.0"
    }
    kubectl = {
      source  = "gavinbunney/kubectl"
      version = ">= 1.7.0"
    }
  }
  backend "s3" {}
}

locals {
  env          = var.env
  region_short = replace(var.region, "ap-southeast-", "apse") # keep in sync with 01-foundation naming
  cluster_name = "${var.project}-${var.env}-${local.region_short}"
}

data "aws_eks_cluster" "core" {
  name = local.cluster_name
}

provider "aws" {
  region = var.region
  default_tags { tags = var.tags }
}

provider "helm" {
  kubernetes {
    host                   = data.aws_eks_cluster.core.endpoint
    cluster_ca_certificate = base64decode(data.aws_eks_cluster.core.certificate_authority[0].data)
    exec {
      api_version = "client.authentication.k8s.io/v1beta1"
      command     = "aws"
      args        = ["eks", "get-token", "--cluster-name", local.cluster_name, "--region", var.region]
    }
  }
}

# Used for the TargetGroupBinding CRD (AWS Load Balancer Controller).
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
