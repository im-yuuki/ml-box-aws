variable "region" {
  type    = string
  default = "ap-southeast-2"
}

variable "env" {
  type    = string
  default = "dev"
}

variable "project" {
  # Keep in sync with 01-foundation's cluster_name + env defaults
  # (cluster name = <project>-<env>-<apseN>).
  type    = string
  default = "jhub-gpu-sandbox"
}

variable "domain" {
  description = "Root domain (e.g. example.com). Hub lives at hub.<domain>."
  type        = string
}

variable "cognito_domain_prefix" {
  description = "Cognito hosted-UI prefix (unique per region). The pool itself lives in 03-platform."
  type        = string
}

variable "z2jh_chart_version" {
  description = "jupyterhub (Z2JH) chart. Default = latest release verified 2026-10-12 (4.4.2)."
  type        = string
  default     = "4.4.2"
}

# Image tags follow the pipeline convention: dev-<gitshortsha>.
variable "cpu_image" {
  description = <<-EOT
    CPU image (ECR). The ECR repo is created by 03-platform; this stack only
    references the image. Tag = dev-<gitshortsha>.
  EOT
  type        = string
  default     = "451058046864.dkr.ecr.ap-southeast-2.amazonaws.com/jhub-gpu-sandbox/cpu:dev-fa3b6fa"
}

variable "gpu_image" {
  description = <<-EOT
    GPU image (ECR). The ECR repo is created by 03-platform; this stack only
    references the image. Tag = dev-<gitshortsha>.
  EOT
  type        = string
  default     = "451058046864.dkr.ecr.ap-southeast-2.amazonaws.com/jhub-gpu-sandbox/gpu:dev-fa3b6fa"
}

variable "vram_commit_mib" {
  type    = number
  default = 8192
}
variable "vram_ceiling_mib" {
  type    = number
  default = 12288
}

# GPU profiles are hidden until the account has a GPU quota (On-Demand / EDP).
variable "enable_gpu_profiles" {
  description = <<-EOT
    Render the GPU profiles (GPU shared L4 + GPU dedicated) in the hub profile
    list. Keep false while there is no GPU quota: the GPU NodePools would
    fail to scale and the profiles would only produce confusing errors.
    The CPU profile stays available either way.
  EOT
  type        = bool
  default     = false
}

# ---------------------------------------------------------------------------
# 03-platform remote state (read-only dependency)
# ---------------------------------------------------------------------------
variable "state_bucket" {
  description = "S3 bucket holding the Terraform state of every stack."
  type        = string
  default     = "jhub-gpu-sandbox-tfstate-451058046864"
}

variable "state_key" {
  description = "State object key of the 03-platform stack (infra: S3/RDS/Cognito/ECR/ALB/ACM)."
  type        = string
  default     = "dev/ap-southeast-2/03-platform.tfstate"
}

# ---------------------------------------------------------------------------
# Hub Service (used by the TargetGroupBinding)
# ---------------------------------------------------------------------------
variable "target_service_name" {
  description = <<-EOT
    Name of the public proxy Service inside the hub namespace. Z2JH names it "proxy-public".
    Confirm with `kubectl get svc -n hub` after the first deploy.
  EOT
  type        = string
  default     = "proxy-public"
}

variable "target_service_port" {
  description = <<-EOT
    Service port of proxy-public targeted by the TargetGroupBinding (80).
    The ALB target group uses the proxy pod target port 8000.
  EOT
  type        = number
  default     = 80
}

variable "tags" {
  type = map(string)
  default = {
    Project     = "jhub-gpu-sandbox"
    Environment = "dev"
    ManagedBy   = "terraform"
  }
}
