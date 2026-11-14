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

# The IRSA trust anchors (OIDC provider ARN + issuer host) are read from the live cluster
# and IAM at plan time — see main.tf. Do not hard-code them here; they change if the
# cluster is rebuilt.
