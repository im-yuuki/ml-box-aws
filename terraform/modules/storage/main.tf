# S3 workspace: pod ephemeral + sync prefix users/<id>/ (mục 7 doc).
# Cô lập prefix thực thi ở runtime (hub AssumeRole kèm session policy theo user);
# role workspace ở đây mở tới bucket để session policy thu hẹp lúc assume.

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
    status = "Enabled" # backup lấy lại file xóa nhầm (mục 7)
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
      noncurrent_days = 30 # giữ bản cũ 30 ngày rồi xóa (tinh chỉnh sau)
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

# Role cho sidecar workspace: hub AssumeRole với session policy giới hạn users/<id>/.
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

# Role cho hub (gắn vào SA hub qua IRSA): chỉ được AssumeRole workspace, không sờ S3 trực tiếp.
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
