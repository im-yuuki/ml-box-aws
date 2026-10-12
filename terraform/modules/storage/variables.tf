variable "cluster_name" { type = string }
variable "oidc_provider" { type = string }
variable "oidc_provider_arn" { type = string }
variable "hub_namespace" {
  type    = string
  default = "hub"
}
variable "tags" { type = map(string) }
