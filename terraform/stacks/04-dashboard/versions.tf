# Dashboard stack (phase 2 của deployment). Producers từ 01-foundation được resolve tự động;
# infra (ALB, ACM, Cognito, VPC) đọc từ 02-platform remote state; HTTPS listener ARN đọc
# từ 03-hub-app remote state.
terraform {
  required_version = ">= 1.6.0"
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
    kubectl = {
      source  = "gavinbunney/kubectl"
      version = ">= 1.7.0"
    }
    random = {
      source  = "hashicorp/random"
      version = "~> 3.0"
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

data "aws_caller_identity" "current" {}

provider "aws" {
  region = var.region
  default_tags { tags = var.tags }
}

# Used for Deployment/Service/TargetGroupBinding CRDs.
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
