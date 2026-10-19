# Declare providers for kubectl_manifest/helm_release/aws_iam_* in this module,
# so Terraform does NOT infer hashicorp/kubectl as the default.
terraform {
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = ">= 5.0"
    }
    helm = {
      source  = "hashicorp/helm"
      version = ">= 2.0"
    }
    kubectl = {
      source  = "gavinbunney/kubectl"
      version = ">= 1.14.0"
    }
  }
}
