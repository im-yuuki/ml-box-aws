data "aws_partition" "current" {}

# ---------------------------------------------------------------------------
# SNS topic that every alert (Prometheus Alertmanager + CloudWatch alarms) publishes to.
# Subscriptions are created manually (email confirmation required), not here.
# ---------------------------------------------------------------------------
resource "aws_sns_topic" "alerts" {
  name              = "${var.project}-${var.env}-${local.region_short}-mlbox-alerts"
  kms_master_key_id = "alias/aws/sns" # default AWS-managed key
  tags              = var.tags
}

# ---------------------------------------------------------------------------
# IRSA: Alertmanager may publish to the alerts topic only.
# ---------------------------------------------------------------------------
resource "aws_iam_role" "alertmanager" {
  name = "${var.project}-${var.env}-${local.region_short}-alertmanager"
  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Federated = data.aws_iam_openid_connect_provider.eks.arn }
      Action    = "sts:AssumeRoleWithWebIdentity"
      Condition = {
        StringEquals = {
          "${local.oidc_issuer_host}:sub" = "system:serviceaccount:monitoring:kube-prometheus-stack-alertmanager"
          "${local.oidc_issuer_host}:aud" = "sts.amazonaws.com"
        }
      }
    }]
  })
  tags = var.tags
}

resource "aws_iam_role_policy" "alertmanager" {
  name = "sns-publish-alerts"
  role = aws_iam_role.alertmanager.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect   = "Allow"
      Action   = ["SNS:Publish"]
      Resource = aws_sns_topic.alerts.arn
    }]
  })
}

# ---------------------------------------------------------------------------
# IRSA: Fluent Bit may create and write the /mlbox log group only.
# ---------------------------------------------------------------------------
resource "aws_cloudwatch_log_group" "mlbox" {
  name              = "/mlbox"
  retention_in_days = 30
  tags              = var.tags
}

resource "aws_iam_role" "fluent_bit" {
  name = "${var.project}-${var.env}-${local.region_short}-fluent-bit"
  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Federated = data.aws_iam_openid_connect_provider.eks.arn }
      Action    = "sts:AssumeRoleWithWebIdentity"
      Condition = {
        StringEquals = {
          "${local.oidc_issuer_host}:sub" = "system:serviceaccount:amazon-cloudwatch:aws-fluent-bit-aws-for-fluent-bit"
          "${local.oidc_issuer_host}:aud" = "sts.amazonaws.com"
        }
      }
    }]
  })
  tags = var.tags
}

resource "aws_iam_role_policy" "fluent_bit" {
  name = "cloudwatch-logs-mlbox"
  role = aws_iam_role.fluent_bit.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect   = "Allow"
        Action   = ["logs:CreateLogGroup"]
        Resource = "arn:${data.aws_partition.current.partition}:logs:${var.region}:${data.aws_caller_identity.current.account_id}:log-group:/mlbox:*"
      },
      {
        Effect   = "Allow"
        Action   = ["logs:CreateLogStream", "logs:PutLogEvents"]
        Resource = "arn:${data.aws_partition.current.partition}:logs:${var.region}:${data.aws_caller_identity.current.account_id}:log-group:/mlbox:log-stream:*"
      },
      {
        Effect   = "Allow"
        Action   = ["logs:DescribeLogGroups", "logs:DescribeLogStreams", "logs:GetLogEvents"]
        Resource = "*"
      }
    ]
  })
}
