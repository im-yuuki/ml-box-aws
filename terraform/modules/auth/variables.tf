variable "cluster_name" { type = string }
variable "domain_prefix" {
  description = "Hosted UI prefix https://<prefix>.auth.<region>.amazoncognito.com (unique per region)."
  type        = string
}
variable "hub_callback_url" {
  description = "E.g. https://hub.example.com/hub/oauth_callback."
  type        = string
}
variable "hub_logout_url" {
  description = "E.g. https://hub.example.com/."
  type        = string
}
variable "tags" { type = map(string) }
