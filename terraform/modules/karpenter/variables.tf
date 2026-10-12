variable "cluster_name" { type = string }
variable "oidc_provider" {
  description = "OIDC issuer URL (không https://), dùng cho IRSA condition."
  type        = string
}
variable "oidc_provider_arn" { type = string }
variable "karpenter_chart_version" { type = string }
variable "interruption_queue_name" { type = string }
variable "kms_key_arn_ebs" {
  type    = string
  default = ""
}
variable "vram_commit_mib" { type = number }
variable "vram_ceiling_mib" { type = number }
variable "gpu_shared_replicas_l4" { type = number }
variable "tags" { type = map(string) }
