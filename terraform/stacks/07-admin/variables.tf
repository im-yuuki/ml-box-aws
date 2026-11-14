variable "region" {
  type    = string
  default = "ap-southeast-2"
}

variable "env" {
  type    = string
  default = "dev"
}

variable "project" {
  # Keep in sync with 01-foundation's cluster_name + env defaults.
  type    = string
  default = "jhub-gpu-sandbox"
}

variable "domain" {
  description = "Root domain, e.g. mlbox.june8th.me. The console is served at admin.<domain> unless admin_host is set."
  type        = string
}

variable "admin_host" {
  description = "Override of the console hostname. Must be inside the Route 53 zone of var.domain."
  type        = string
  default     = ""
}

# ---------------------------------------------------------------------------
# Remote state (read-only dependencies)
# ---------------------------------------------------------------------------
variable "state_bucket" {
  description = "S3 bucket holding the Terraform state of every stack. Must be the state bucket created by 00-bootstrap - the same one this stack's own backend.hcl points to."
  type        = string
}

variable "state_key" {
  description = "State object key of the 02-platform stack. Defaults to <env>/<region>/02-platform.tfstate when left empty."
  type        = string
  default     = ""
}

variable "state_key_hub_app" {
  description = "State object key of the 03-hub-app stack (HTTPS listener ARN). Defaults to <env>/<region>/03-hub-app.tfstate when left empty."
  type        = string
  default     = ""
}

# ---------------------------------------------------------------------------
# Application
# ---------------------------------------------------------------------------
variable "admin_image" {
  description = "Console image, e.g. ghcr.io/<owner>/mlbox-admin:<40-char commit sha>. Must be published before deploy_admin=true."
  type        = string
}

variable "admin_username" {
  description = "Login name of the single administrator."
  type        = string
  default     = "admin"
}

variable "admin_password_hash" {
  description = "scrypt hash of the administrator password. Generate with: ADMIN_PASSWORD='...' npm run hash-password (in web/admin)."
  type        = string
  sensitive   = true
  validation {
    condition     = can(regex("^scrypt[$][0-9]+[$][0-9]+[$][0-9]+[$][A-Za-z0-9_-]+[$][A-Za-z0-9_-]+$", var.admin_password_hash))
    error_message = "admin_password_hash must be the output of npm run hash-password (scrypt$N$r$p$salt$hash)."
  }
}

variable "admin_allowed_cidrs" {
  description = "Optional source IP allowlist enforced on the ALB rule. Empty means the console is reachable from anywhere and protected by the login only."
  type        = list(string)
  default     = []
}

variable "enable_database" {
  description = "Let the console read the application database (users, sandboxes, audit). The session is forced read-only. Needs the 02-platform usage database."
  type        = bool
  default     = true
}

variable "enable_actions" {
  description = <<-EOT
    Allow the console to make changes: stop a sandbox through the Hub, disable or enable a Cognito account, end the sessions
    of a user and move a Space to another plan. Every change needs a written reason and is stored in the table
    mlbox_admin_audit before it runs. Off by default: the console then only reads, and the IAM role and the Hub token
    that the changes need are not created.
  EOT
  type        = bool
  default     = false
}

variable "enable_cost_explorer" {
  description = "Allow ce:GetCostAndUsage and show the cost page. Cost Explorer must be enabled in the billing console; each API call costs $0.01 and results are cached for 6 hours."
  type        = bool
  default     = false
}

variable "deploy_admin" {
  description = <<-EOT
    Gate the Kubernetes resources and the ALB rule. Set false on the first apply to create only the
    IAM role, certificate, DNS record and target group, then flip true after the image is published.
  EOT
  type        = bool
  default     = false
}

variable "tags" {
  type = map(string)
  default = {
    Project     = "jhub-gpu-sandbox"
    Environment = "dev"
    ManagedBy   = "terraform"
  }
}
