# Account ID appended to the bucket name so it is globally unique, no naming brainstorm needed.
data "aws_caller_identity" "current" {}

locals {
  bucket = "${var.project}-tfstate-${data.aws_caller_identity.current.account_id}"
  table  = "${var.project}-tflock"
}

# Persistent DNS boundary for the project. Cloudflare remains authoritative for
# the parent zone; it delegates only `mlbox.june8th.me` to these nameservers.
resource "aws_route53_zone" "project" {
  name = var.domain
  tags = var.tags
}

resource "aws_acm_certificate" "notebook" {
  domain_name       = "notebook.${var.domain}"
  validation_method = "DNS"
  tags              = var.tags

  lifecycle {
    create_before_destroy = true
  }
}

resource "aws_acm_certificate" "dashboard" {
  domain_name       = var.domain
  validation_method = "DNS"
  tags              = var.tags

  lifecycle {
    create_before_destroy = true
  }
}

resource "aws_route53_record" "acm_validation_notebook" {
  zone_id = aws_route53_zone.project.zone_id
  name    = one(aws_acm_certificate.notebook.domain_validation_options).resource_record_name
  type    = one(aws_acm_certificate.notebook.domain_validation_options).resource_record_type
  ttl     = 60
  records = [one(aws_acm_certificate.notebook.domain_validation_options).resource_record_value]
}

resource "aws_route53_record" "acm_validation_dashboard" {
  zone_id = aws_route53_zone.project.zone_id
  name    = one(aws_acm_certificate.dashboard.domain_validation_options).resource_record_name
  type    = one(aws_acm_certificate.dashboard.domain_validation_options).resource_record_type
  ttl     = 60
  records = [one(aws_acm_certificate.dashboard.domain_validation_options).resource_record_value]
}

resource "aws_acm_certificate_validation" "notebook" {
  count = var.validate_certificates ? 1 : 0

  certificate_arn         = aws_acm_certificate.notebook.arn
  validation_record_fqdns = [aws_route53_record.acm_validation_notebook.fqdn]
}

resource "aws_acm_certificate_validation" "dashboard" {
  count = var.validate_certificates ? 1 : 0

  certificate_arn         = aws_acm_certificate.dashboard.arn
  validation_record_fqdns = [aws_route53_record.acm_validation_dashboard.fqdn]
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
  for_each = toset(["01-foundation", "02-platform", "03-hub-app", "04-dashboard", "99-unverified-gpu"])

  filename        = "${path.module}/../${each.value}/backend.hcl"
  file_permission = "0644"
  content         = <<-EOT
    bucket         = "${local.bucket}"
    key            = "${var.env}/${var.region}/${each.value}.tfstate"
    region         = "${var.region}"
    dynamodb_table = "${local.table}"
    encrypt        = true
  EOT
}
