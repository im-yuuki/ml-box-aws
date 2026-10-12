# Stack 00-bootstrap: tạo S3 state bucket + DynamoDB lock table.
# Chạy 1 lần mỗi account (bucket/table dùng chung mọi region/env).
# State local — file terraform.tfstate KHÔNG commit git.
terraform {
  required_version = ">= 1.6.0"
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
  }
}

provider "aws" {
  region = var.region
  default_tags {
    tags = var.tags
  }
}
