variable "cluster_name" { type = string }
variable "vpc_id" { type = string }
variable "vpc_cidr" { type = string }
variable "private_subnet_ids" { type = list(string) }
variable "oidc_provider_arn" { type = string }
# Issuer host without the scheme, e.g. oidc.eks.ap-southeast-2.amazonaws.com/id/XXXX.
variable "oidc_issuer_host" { type = string }
variable "storage_class_name" {
  type    = string
  default = "efs-sc"
}
variable "tags" {
  type    = map(string)
  default = {}
}
