# Account ID appended to the bucket name so it is globally unique, no naming brainstorm needed.
data "aws_caller_identity" "current" {}

locals {
  bucket = "${var.project}-tfstate-${data.aws_caller_identity.current.account_id}"
  table  = "${var.project}-tflock"
}

resource "aws_s3_bucket" "state" {
  bucket = local.bucket
  tags   = var.tags
}

resource "aws_s3_bucket_versioning" "state" {
  bucket = aws_s3_bucket.state.id
  versioning_configuration {
    status = "Enabled"
  }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "state" {
  bucket = aws_s3_bucket.state.id
  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

resource "aws_s3_bucket_public_access_block" "state" {
  bucket                  = aws_s3_bucket.state.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_dynamodb_table" "lock" {
  name         = local.table
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "LockID"

  attribute {
    name = "LockID"
    type = "S"
  }

  tags = var.tags
}

# Generate backend.hcl inside every consuming stack so init picks it up
# via `terraform init -backend-config=backend.hcl` with zero manual copying.
resource "local_file" "stack_backends" {
  for_each = toset(["01-foundation", "02-gpu", "03-hub"])

  filename        = "${path.module}/../${each.value}/backend.hcl"
  file_permission = "0644"
  content = <<-EOT
    bucket         = "${local.bucket}"
    key            = "${var.env}/${var.region}/${each.value}.tfstate"
    region         = "${var.region}"
    dynamodb_table = "${local.table}"
    encrypt        = true
  EOT
}
