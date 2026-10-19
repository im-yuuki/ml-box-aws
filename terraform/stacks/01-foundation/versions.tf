# Foundation stack (phases 1-2): network + EKS + Karpenter
# Region: ap-southeast-2 (Sydney) — required variable, no hard-coded default
# Latest decisions:
# - No MIG for now (no MIG manager installed)
# - First GPU shared pool: L4 (g6), commit 8GiB / ceiling 12GiB, replicas=3 @ factor 1.0
# - Outbound only: IPv4 single NAT GW + IPv6 dual-stack, user pods get no inbound
# - 1 NAT GW (dev, single point of failure — prod should use 1/AZ)

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
  # Remote S3 state + lock — fill in backend.hcl at init:
  # terraform init -backend-config=backend.hcl
  # Sample backend.hcl: bucket, key=dev/foundation.tfstate, region=ap-southeast-2, dynamodb_table, encrypt=true
  backend "s3" {}
}

provider "aws" {
  region = var.region
  default_tags {
    tags = var.tags
  }
}

# Kubernetes/Helm providers configured after the EKS cluster exists (avoids provider cycles in stacks 2/3).
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
