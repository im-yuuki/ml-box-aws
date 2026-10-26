# Stack 00-bootstrap: persistent state backend plus delegated DNS/ACM resources.
# Run once per account/environment (bucket/table shared across every region/env).
# Local state — the terraform.tfstate file is NOT committed to git.
terraform {
  required_version = ">= 1.6.0"
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
    # Writes backend.hcl for stacks 01/02/03 so the state bucket name
    # (with its account-ID suffix) never has to be typed by hand.
    local = {
      source  = "hashicorp/local"
      version = "~> 2.1"
    }
  }
}

provider "aws" {
  region = var.region
  default_tags {
    tags = var.tags
  }
}
