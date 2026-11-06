# GPU add-on stack. Split from 01-foundation to avoid an AWS<->K8s provider cycle.
# Provider config resolves the cluster endpoint/CA via data "aws_eks_cluster",
# so nothing has to be copied from the 01-foundation outputs ever again.
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
