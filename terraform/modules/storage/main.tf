# S3 workspace: pod ephemeral + sync prefix users/<id>/ (handoff doc §7).
# Isolates the execution prefix at runtime (hub AssumeRole with a per-user session policy);
# the workspace role here grants bucket-wide access so the session policy narrows it at assume time.

data "aws_caller_identity" "current" {}

resource "aws_kms_key" "workspace" {
  description             = "${var.cluster_name} workspace bucket key"
  deletion_window_in_days = 7
  tags                    = var.tags
}

resource "aws_s3_bucket" "workspace" {
  bucket = "${var.cluster_name}-workspace-${data.aws_caller_identity.current.account_id}"
  tags   = var.tags
}

resource "aws_s3_bucket_versioning" "workspace" {
  bucket = aws_s3_bucket.workspace.id
  versioning_configuration {
    status = "Enabled" # versioning to recover accidentally deleted objects (§7)
  }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "workspace" {
  bucket = aws_s3_bucket.workspace.id
  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm     = "aws:kms"
      kms_master_key_id = aws_kms_key.workspace.arn
    }
  }
}

resource "aws_s3_bucket_lifecycle_configuration" "workspace" {
  bucket = aws_s3_bucket.workspace.id
  rule {
    id     = "noncurrent-expiry"
    status = "Enabled"
    filter {}
    noncurrent_version_expiration {
      noncurrent_days = 30 # keep old versions 30 days then delete (tune later)
    }
  }
  rule {
    id     = "abort-multipart"
    status = "Enabled"
    filter {}
    abort_incomplete_multipart_upload {
      days_after_initiation = 7
    }
  }
}

resource "aws_s3_bucket_public_access_block" "workspace" {
  bucket                  = aws_s3_bucket.workspace.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

# Role for the workspace sidecar: hub AssumeRole with a session policy limited to users/<id>/.
resource "aws_iam_role" "workspace" {
  name = "${var.cluster_name}-workspace"
  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { AWS = aws_iam_role.hub.arn }
      Action    = "sts:AssumeRole"
    }]
  })
  tags = var.tags
}

resource "aws_iam_role_policy" "workspace" {
  name = "s3-workspace"
  role = aws_iam_role.workspace.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect   = "Allow"
      Action   = ["s3:ListBucket", "s3:GetObject", "s3:PutObject", "s3:DeleteObject"]
      Resource = [aws_s3_bucket.workspace.arn, "${aws_s3_bucket.workspace.arn}/*"]
    }]
  })
}

# Role for the hub (attached to the hub SA via IRSA): may only AssumeRole the workspace role, no direct S3 access.
resource "aws_iam_role" "hub" {
  name = "${var.cluster_name}-hub"
  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Federated = var.oidc_provider_arn }
      Action    = "sts:AssumeRoleWithWebIdentity"
      Condition = {
        StringEquals = {
          "${var.oidc_provider}:sub" = "system:serviceaccount:${var.hub_namespace}:hub"
        }
      }
    }]
  })
  tags = var.tags
}

resource "aws_iam_role_policy" "hub_assume" {
  name = "assume-workspace"
  role = aws_iam_role.hub.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect   = "Allow"
      Action   = "sts:AssumeRole"
      Resource = aws_iam_role.workspace.arn
    }]
  })
}
