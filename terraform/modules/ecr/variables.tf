variable "project" { type = string }
variable "repo_names" {
  type    = list(string)
  default = ["cpu", "gpu"]
}
variable "tags" { type = map(string) }
