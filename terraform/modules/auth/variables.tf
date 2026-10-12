variable "cluster_name" { type = string }
variable "domain_prefix" {
  description = "Prefix hosted UI https://<prefix>.auth.<region>.amazoncognito.com (unique theo region)."
  type        = string
}
variable "hub_callback_url" {
  description = "VD https://hub.example.com/hub/oauth_callback."
  type        = string
}
variable "hub_logout_url" {
  description = "VD https://hub.example.com/."
  type        = string
}
variable "tags" { type = map(string) }
