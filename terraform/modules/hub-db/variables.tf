variable "cluster_name" { type = string }
variable "engine_version" {
  description = "Postgres version (check region availability: 16.x is available in ap-southeast-2)."
  type        = string
  default     = "16.15"
}
variable "instance_class" {
  type    = string
  default = "db.t4g.micro"
}
variable "allocated_storage" {
  type    = number
  default = 20
}
variable "vpc_id" { type = string }
variable "subnet_ids" { type = list(string) }
variable "allowed_security_group_id" {
  description = "EKS node SG (only nodes connect on 5432)."
  type        = string
}
variable "backup_retention_days" {
  type    = number
  default = 7
}
variable "deletion_protection" {
  description = "false in lab so destroy works; true in prod."
  type        = bool
  default     = false
}
variable "tags" { type = map(string) }
