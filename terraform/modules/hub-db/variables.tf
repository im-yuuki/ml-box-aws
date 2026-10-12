variable "cluster_name" { type = string }
variable "engine_version" {
  description = "Postgres version (verify ở region: 16.x có ở ap-southeast-2)."
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
  description = "Node SG của EKS (chỉ node được nối 5432)."
  type        = string
}
variable "backup_retention_days" {
  type    = number
  default = 7
}
variable "deletion_protection" {
  description = "Lab=false để destroy được; prod=true."
  type        = bool
  default     = false
}
variable "tags" { type = map(string) }
