variable "region" {
  type    = string
  default = "ap-southeast-2"
}

variable "env" {
  type    = string
  default = "dev"
}

variable "project" {
  type    = string
  default = "jhub-gpu-sandbox"
}

variable "state_bucket" {
  description = "Bucket holding the remote state of the other stacks (created by 00-bootstrap)."
  type        = string
  default     = "jhub-gpu-sandbox-tfstate-451058046864"
}

variable "tags" {
  type = map(string)
  default = {
    Project     = "jhub-gpu-sandbox"
    Environment = "dev"
    ManagedBy   = "terraform"
  }
}

# OIDC provider of the EKS cluster; both stacks read these from 01-foundation.
# Keep them in sync if the cluster is recreated.
variable "oidc_provider_arn" {
  type    = string
  default = "arn:aws:iam::451058046864:oidc-provider/oidc.eks.ap-southeast-2.amazonaws.com/id/B93392515DFB4B1A6FAE09D7B9DC6580"
}

variable "oidc_issuer_host" {
  type    = string
  default = "oidc.eks.ap-southeast-2.amazonaws.com/id/B93392515DFB4B1A6FAE09D7B9DC6580"
}
