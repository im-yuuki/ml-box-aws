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
  description = "Root domain. Dashboard serves at the apex (var.domain); notebook at notebook.<domain>."
  type        = string
}

# ---------------------------------------------------------------------------
# Remote state (read-only dependencies)
# ---------------------------------------------------------------------------
variable "state_bucket" {
  description = "S3 bucket holding the Terraform state of every stack."
  type        = string
  default     = "jhub-gpu-sandbox-tfstate-451058046864"
}

variable "state_key" {
  description = "State object key of the 02-platform stack (ALB, ACM, Cognito, VPC)."
  type        = string
  default     = "dev/ap-southeast-2/02-platform.tfstate"
}

variable "state_key_hub_app" {
  description = "State object key of the 03-hub-app stack (HTTPS listener ARN)."
  type        = string
  default     = "dev/ap-southeast-2/03-hub-app.tfstate"
}

# ---------------------------------------------------------------------------
# Dashboard image
# ---------------------------------------------------------------------------
variable "dashboard_image" {
  description = "ECR image for the dashboard (tag = dev-<sha>). Must be pushed before deploy_dashboard=true."
  type        = string
}

variable "bff_image" {
  description = "ECR image for the dashboard BFF (tag = dev-<sha>). Must be pushed before deploy_dashboard=true."
  type        = string
}

variable "bff_secure_cookies" {
  description = "Set Secure on the BFF session cookie. Keep true behind the HTTPS ALB."
  type        = bool
  default     = true
}

variable "cpu_quota_hours" {
  description = "Policy quota exposed by the BFF; historical CPU-hours tracking is not enabled."
  type        = number
  default     = 32
  validation {
    condition     = var.cpu_quota_hours >= 0
    error_message = "cpu_quota_hours must be non-negative."
  }
}

variable "ram_quota_gb" {
  description = "RAM quota exposed by the BFF."
  type        = number
  default     = 24
  validation {
    condition     = var.ram_quota_gb >= 0
    error_message = "ram_quota_gb must be non-negative."
  }
}

variable "storage_quota_gb" {
  description = "Storage quota exposed by the BFF; storage usage tracking is not enabled."
  type        = number
  default     = 20
  validation {
    condition     = var.storage_quota_gb >= 0
    error_message = "storage_quota_gb must be non-negative."
  }
}

variable "gpu_quota_hours" {
  description = "GPU-hours policy quota. Keep at zero while GPU is disabled."
  type        = number
  default     = 0
  validation {
    condition     = var.gpu_quota_hours >= 0
    error_message = "gpu_quota_hours must be non-negative."
  }
}

variable "bff_replicas" {
  description = "Number of BFF replicas. Keep at least 2 for production once session storage is externalized."
  type        = number
  default     = 1
}

variable "deploy_dashboard" {
  description = <<-EOT
    Gate k8s resources (Deployment, Service, TGB) + ALB listener rule/cert.
    Set false on first apply to create only the ECR repos + target group,
    then flip true after pushing the image.
  EOT
  type        = bool
  default     = false
}

variable "enable_usage_history" {
  description = "Enable usage history persistence in the dedicated dashboard PostgreSQL database (also enable it in 02-platform)."
  type        = bool
  default     = false
}

variable "dashboard_replicas" {
  type    = number
  default = 1
}

variable "tags" {
  type = map(string)
  default = {
    Project     = "jhub-gpu-sandbox"
    Environment = "dev"
    ManagedBy   = "terraform"
  }
}
