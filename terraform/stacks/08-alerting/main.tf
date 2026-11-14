# Alerting + centralized logs.
# Creates: SNS topic, IRSA roles (alertmanager, fluent-bit), CloudWatch log group /mlbox,
# CloudWatch alarms for ALB (hub TG + dashboard TG) and RDS (hub + usage).
# Reads 02-platform and 04-dashboard via remote state for ARNs. Does not touch those stacks.

locals {
  region_short = replace(var.region, "ap-southeast-", "apse") # keep in sync with other stacks
  cluster_name = "${var.project}-${var.env}-${local.region_short}"
}

data "aws_caller_identity" "current" {}

data "terraform_remote_state" "platform" {
  backend = "s3"
  config = {
    bucket = var.state_bucket
    key    = "dev/${var.region}/02-platform.tfstate"
    region = var.region
  }
}

data "terraform_remote_state" "dashboard" {
  backend = "s3"
  config = {
    bucket = var.state_bucket
    key    = "dev/${var.region}/04-dashboard.tfstate"
    region = var.region
  }
}

provider "aws" {
  region = var.region
  default_tags { tags = var.tags }
}
