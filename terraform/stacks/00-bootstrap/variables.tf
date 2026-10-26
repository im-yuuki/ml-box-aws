variable "region" {
  description = "Region hosting the bucket/table (shared across all regions; keep ap-southeast-2)."
  type        = string
  default     = "ap-southeast-2"
}

variable "project" {
  type    = string
  default = "jhub-gpu-sandbox"
}

variable "env" {
  description = "Environment used in the generated backend.hcl keys: <env>/<region>/<stack>.tfstate"
  type        = string
  default     = "dev"
}

variable "domain" {
  description = "Persistent project subdomain delegated from the parent Cloudflare zone."
  type        = string
  default     = "mlbox.june8th.me"
}

variable "validate_certificates" {
  description = "Create blocking ACM validation resources after the Cloudflare NS delegation is active."
  type        = bool
  default     = false
}

variable "tags" {
  type = map(string)
  default = {
    Project   = "jhub-gpu-sandbox"
    ManagedBy = "terraform"
  }
}
