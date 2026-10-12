variable "region" {
  description = "Region đặt bucket/table (dùng chung mọi region, để ap-southeast-2)."
  type        = string
  default     = "ap-southeast-2"
}

variable "project" {
  type    = string
  default = "jhub-gpu-sandbox"
}

variable "tags" {
  type = map(string)
  default = {
    Project   = "jhub-gpu-sandbox"
    ManagedBy = "terraform"
  }
}
