# Foundation stack (phase 1-2): network + EKS + Karpenter
# Region: ap-southeast-2 (Sydney) — biến bắt buộc, không default hard-code
# Quyết định mới:
# - Không dùng MIG tạm thời (không cài MIG manager)
# - GPU shared đầu tiên: L4 (g6), commit 8GiB / ceiling 12GiB, replicas=3 @ factor 1.0
# - Outbound only: IPv4 single NAT GW + IPv6 dual-stack, user pod không inbound
# - 1 NAT GW (dev, single point of failure — prod nên 1/AZ)

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
  # Remote state S3 + lock — điền backend.hcl khi init:
  # terraform init -backend-config=backend.hcl
  # backend.hcl mẫu: bucket, key=dev/foundation.tfstate, region=ap-southeast-2, dynamodb_table, encrypt=true
  backend "s3" {}
}

provider "aws" {
  region = var.region
  default_tags {
    tags = var.tags
  }
}

# Providers Kubernetes/Helm cấu hình sau khi EKS tạo (tránh cycle provider trong stack 2/3).
provider "helm" {
  kubernetes {
    host                   = module.eks.cluster_endpoint
    cluster_ca_certificate = base64decode(module.eks.cluster_certificate_authority_data)
    exec {
      api_version = "client.authentication.k8s.io/v1beta1"
      command     = "aws"
      args        = ["eks", "get-token", "--cluster-name", module.eks.cluster_name, "--region", var.region]
    }
  }
}

provider "kubectl" {
  host                   = module.eks.cluster_endpoint
  cluster_ca_certificate = base64decode(module.eks.cluster_certificate_authority_data)
  load_config_file       = false
  exec {
    api_version = "client.authentication.k8s.io/v1beta1"
    command     = "aws"
    args        = ["eks", "get-token", "--cluster-name", module.eks.cluster_name, "--region", var.region]
  }
}
