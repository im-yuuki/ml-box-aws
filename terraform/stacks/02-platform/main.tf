locals {
  hub_host = "notebook.${var.domain}"
}

# Persistent DNS and ACM resources are created by 00-bootstrap and kept in its
# local state. Discover them by stable names after bootstrap has been applied.
# 02-platform owns only the ALB and its Route53 alias records.
data "aws_route53_zone" "project" {
  name         = var.domain
  private_zone = false
  tags = {
    Project   = var.project
    ManagedBy = "terraform"
  }
}

data "aws_acm_certificate" "notebook" {
  domain      = local.hub_host
  statuses    = ["PENDING_VALIDATION", "ISSUED"]
  most_recent = true
  tags = {
    Project   = var.project
    ManagedBy = "terraform"
  }
}

data "aws_acm_certificate" "dashboard" {
  domain      = var.domain
  statuses    = ["PENDING_VALIDATION", "ISSUED"]
  most_recent = true
  tags = {
    Project   = var.project
    ManagedBy = "terraform"
  }
}

# ---------------------------------------------------------------------------
# Auto-discovery of the 01-foundation resources. Keep here (not versions.tf)
# because module.* consumers below reference these locals.
# ---------------------------------------------------------------------------

# Network module privately-labelled subnets carry:
#   tag kubernetes.io/role/internal-elb = "1"
#   tag kubernetes.io/cluster/<cluster> = "shared"
data "aws_subnets" "private" {
  filter {
    name   = "tag:kubernetes.io/role/internal-elb"
    values = ["1"]
  }
  filter {
    name   = "tag:kubernetes.io/cluster/${local.cluster_name}"
    values = ["shared"]
  }
}

# Network module public subnets carry:
#   tag kubernetes.io/role/elb = "1"
#   tag kubernetes.io/cluster/<cluster> = "shared"
# These are the subnets the internet-facing ALB lives in.
data "aws_subnets" "public" {
  filter {
    name   = "tag:kubernetes.io/role/elb"
    values = ["1"]
  }
  filter {
    name   = "tag:kubernetes.io/cluster/${local.cluster_name}"
    values = ["shared"]
  }
}

# Derive the VPC ID from the first private subnet - no manual copy needed.
data "aws_subnet" "one_private" {
  id = element(data.aws_subnets.private.ids, 0)
}

# EKS module tags the node security group with karpenter.sh/discovery=<cluster>.
data "aws_security_groups" "node" {
  filter {
    name   = "tag:karpenter.sh/discovery"
    values = [local.cluster_name]
  }
}

data "aws_caller_identity" "current" {}

data "aws_partition" "current" {}

locals {
  private_subnet_ids = data.aws_subnets.private.ids
  public_subnet_ids  = data.aws_subnets.public.ids
  vpc_id             = data.aws_subnet.one_private.vpc_id
  node_security_group_id = one(
    data.aws_security_groups.node.ids
  )
  oidc_url               = data.aws_eks_cluster.core.identity[0].oidc[0].issuer
  oidc_provider          = replace(local.oidc_url, "https://", "")
  oidc_provider_arn      = "arn:aws:iam::${data.aws_caller_identity.current.account_id}:oidc-provider/${local.oidc_provider}"
  github_oidc_url        = "https://token.actions.githubusercontent.com"
  github_oidc_host       = "token.actions.githubusercontent.com"
  github_repo_arn_prefix = "arn:${data.aws_partition.current.partition}:ecr:${var.region}:${data.aws_caller_identity.current.account_id}:repository/jhub-gpu-sandbox/"
}

# If this provider already exists in the AWS account, import its ARN into this
# resource before applying. That makes adoption explicit instead of risking a
# duplicate-provider create or accidentally trusting a different issuer.
resource "aws_iam_openid_connect_provider" "github_actions" {
  url            = local.github_oidc_url
  client_id_list = ["sts.amazonaws.com"]
  tags           = var.tags
}

resource "aws_iam_role" "github_publisher" {
  name = "${local.cluster_name}-github-publisher"
  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Federated = aws_iam_openid_connect_provider.github_actions.arn }
      Action    = "sts:AssumeRoleWithWebIdentity"
      Condition = {
        StringEquals = {
          "${local.github_oidc_host}:aud" = "sts.amazonaws.com"
          "${local.github_oidc_host}:sub" = "repo:im-yuuki/ml-box-aws:ref:refs/heads/master"
        }
      }
    }]
  })
  tags = var.tags
}

resource "aws_iam_role_policy" "github_publisher" {
  name = "publish-project-ecr-images"
  role = aws_iam_role.github_publisher.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect   = "Allow"
        Action   = ["ecr:GetAuthorizationToken"]
        Resource = "*"
      },
      {
        Effect = "Allow"
        Action = [
          "ecr:BatchCheckLayerAvailability",
          "ecr:BatchGetImage",
          "ecr:CompleteLayerUpload",
          "ecr:InitiateLayerUpload",
          "ecr:PutImage",
          "ecr:UploadLayerPart",
        ]
        Resource = [
          "${local.github_repo_arn_prefix}dashboard",
          "${local.github_repo_arn_prefix}bff",
          "${local.github_repo_arn_prefix}cpu",
          "${local.github_repo_arn_prefix}gpu",
        ]
      },
    ]
  })
}

resource "aws_iam_role" "github_deployer" {
  name = "${local.cluster_name}-github-deployer"
  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Federated = aws_iam_openid_connect_provider.github_actions.arn }
      Action    = "sts:AssumeRoleWithWebIdentity"
      Condition = {
        StringEquals = {
          "${local.github_oidc_host}:aud" = "sts.amazonaws.com"
          "${local.github_oidc_host}:sub" = "repo:im-yuuki/ml-box-aws:environment:production"
        }
      }
    }]
  })
  tags = var.tags
}

resource "aws_iam_role_policy" "github_deployer" {
  name = "describe-production-eks-cluster"
  role = aws_iam_role.github_deployer.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect   = "Allow"
      Action   = ["eks:DescribeCluster"]
      Resource = "arn:${data.aws_partition.current.partition}:eks:${var.region}:${data.aws_caller_identity.current.account_id}:cluster/${local.cluster_name}"
    }]
  })
}

# API access entries do not receive an EKS managed policy: authorization is
# restricted to this explicit Kubernetes group and namespaced Role below.
resource "aws_eks_access_entry" "github_deployer" {
  cluster_name      = local.cluster_name
  principal_arn     = aws_iam_role.github_deployer.arn
  kubernetes_groups = ["github-dashboard-deployer"]
  type              = "STANDARD"
}

resource "kubectl_manifest" "github_deployer_role" {
  yaml_body = yamlencode({
    apiVersion = "rbac.authorization.k8s.io/v1"
    kind       = "Role"
    metadata = {
      name      = "github-dashboard-deployer"
      namespace = "dashboard"
    }
    rules = [{
      apiGroups     = ["apps"]
      resources     = ["deployments"]
      resourceNames = ["dashboard", "bff"]
      verbs         = ["get", "patch", "watch"]
    }]
  })
}

resource "kubectl_manifest" "github_deployer_role_binding" {
  yaml_body = yamlencode({
    apiVersion = "rbac.authorization.k8s.io/v1"
    kind       = "RoleBinding"
    metadata = {
      name      = "github-dashboard-deployer"
      namespace = "dashboard"
    }
    roleRef = {
      apiGroup = "rbac.authorization.k8s.io"
      kind     = "Role"
      name     = "github-dashboard-deployer"
    }
    subjects = [{
      apiGroup = "rbac.authorization.k8s.io"
      kind     = "Group"
      name     = "github-dashboard-deployer"
    }]
  })
  depends_on = [kubectl_manifest.github_deployer_role]
}

# ---------------------------------------------------------------------------
# Modules
# ---------------------------------------------------------------------------

module "storage" {
  source = "../../modules/storage"

  cluster_name      = local.cluster_name
  oidc_provider     = local.oidc_provider
  oidc_provider_arn = local.oidc_provider_arn
  tags              = var.tags
}

module "hub_db" {
  source = "../../modules/hub-db"

  cluster_name              = local.cluster_name
  vpc_id                    = local.vpc_id
  subnet_ids                = local.private_subnet_ids
  allowed_security_group_id = local.node_security_group_id
  tags                      = var.tags
}

# Isolated persistence for dashboard usage history. Keep it opt-in independently
# of the Hub database so the dashboard feature can remain disabled by default.
resource "aws_db_subnet_group" "dashboard_usage" {
  count      = var.enable_dashboard_usage_history ? 1 : 0
  name       = "${local.cluster_name}-dashboard-usage"
  subnet_ids = local.private_subnet_ids
  tags       = var.tags
}

resource "aws_security_group" "dashboard_usage_db" {
  count       = var.enable_dashboard_usage_history ? 1 : 0
  name        = "${local.cluster_name}-dashboard-usage-db"
  description = "Dashboard usage history PostgreSQL; EKS node group only"
  vpc_id      = local.vpc_id
  tags        = var.tags
}

resource "aws_vpc_security_group_ingress_rule" "dashboard_usage_db" {
  count                        = var.enable_dashboard_usage_history ? 1 : 0
  security_group_id            = aws_security_group.dashboard_usage_db[0].id
  referenced_security_group_id = local.node_security_group_id
  from_port                    = 5432
  to_port                      = 5432
  ip_protocol                  = "tcp"
  description                  = "Postgres from EKS node SG (dashboard BFF runs on nodes)"
}

resource "aws_db_instance" "dashboard_usage" {
  count      = var.enable_dashboard_usage_history ? 1 : 0
  identifier = "${local.cluster_name}-dashboard-usage"

  engine         = "postgres"
  engine_version = "16.15"
  instance_class = "db.t4g.micro"

  allocated_storage           = 20
  storage_type                = "gp3"
  storage_encrypted           = true
  db_name                     = "usage_history"
  username                    = "usage_admin"
  manage_master_user_password = true

  db_subnet_group_name   = aws_db_subnet_group.dashboard_usage[0].name
  vpc_security_group_ids = [aws_security_group.dashboard_usage_db[0].id]
  publicly_accessible    = false
  multi_az               = false

  backup_retention_period    = 7
  backup_window              = "18:00-19:00"
  copy_tags_to_snapshot      = true
  delete_automated_backups   = true
  skip_final_snapshot        = false
  final_snapshot_identifier  = "${local.cluster_name}-dashboard-usage-final"
  deletion_protection        = true
  auto_minor_version_upgrade = true

  tags = var.tags
}

module "auth" {
  source = "../../modules/auth"

  cluster_name     = local.cluster_name
  domain_prefix    = var.cognito_domain_prefix
  hub_callback_url = "https://${local.hub_host}/hub/oauth_callback"
  hub_logout_url   = "https://${local.hub_host}/"
  tags             = var.tags
}

# Dashboard BFF refresh-token sessions.
resource "aws_dynamodb_table" "bff_sessions" {
  name         = "mlbox_sessions"
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "sessionId"

  attribute {
    name = "sessionId"
    type = "S"
  }

  ttl {
    enabled        = true
    attribute_name = "expiresAt"
  }

  server_side_encryption {
    enabled = true
  }

  point_in_time_recovery {
    enabled = true
  }

  tags = var.tags
}

resource "aws_iam_role" "bff_sessions" {
  name = "${local.cluster_name}-bff-sessions"
  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Federated = local.oidc_provider_arn }
      Action    = "sts:AssumeRoleWithWebIdentity"
      Condition = {
        StringEquals = {
          "${local.oidc_provider}:sub" = "system:serviceaccount:dashboard:bff"
          "${local.oidc_provider}:aud" = "sts.amazonaws.com"
        }
      }
    }]
  })
  tags = var.tags
}

resource "aws_iam_role_policy" "bff_sessions" {
  name = "dynamodb-sessions"
  role = aws_iam_role.bff_sessions.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect = "Allow"
      Action = [
        "dynamodb:GetItem",
        "dynamodb:PutItem",
        "dynamodb:UpdateItem",
        "dynamodb:DeleteItem",
      ]
      Resource = aws_dynamodb_table.bff_sessions.arn
    }]
  })
}

module "ecr" {
  source = "../../modules/ecr"

  project = "jhub-gpu-sandbox"
  tags    = var.tags
}

# ALB + target group + Route53 aliases + AWS Load Balancer Controller.
# The persistent delegated zone and ACM certificates are owned by 00-bootstrap.
module "ingress_dns" {
  source = "../../modules/ingress-dns"

  cluster_name                = local.cluster_name
  domain                      = var.domain
  vpc_id                      = local.vpc_id
  oidc_provider               = local.oidc_provider
  oidc_provider_arn           = local.oidc_provider_arn
  lb_controller_chart_version = var.lb_controller_chart_version
  subnet_ids                  = local.public_subnet_ids
  node_security_group_id      = local.node_security_group_id
  proxy_port                  = var.proxy_port
  manage_route53              = var.manage_route53
  route53_zone_id             = data.aws_route53_zone.project.zone_id
  certificate_arn             = data.aws_acm_certificate.notebook.arn
  apex_certificate_arn        = data.aws_acm_certificate.dashboard.arn
  certificate_status          = data.aws_acm_certificate.notebook.status
  apex_certificate_status     = data.aws_acm_certificate.dashboard.status
  route53_zone_nameservers    = data.aws_route53_zone.project.name_servers
  tags                        = var.tags
}

# ---------------------------------------------------------------------------
# Hub database URL (consumed by 03-hub-app)
# ---------------------------------------------------------------------------

# Master password is managed by RDS inside Secrets Manager (never hard-coded).
data "aws_secretsmanager_secret_version" "db" {
  secret_id = module.hub_db.master_secret_arn
}

locals {
  db_password = jsondecode(data.aws_secretsmanager_secret_version.db.secret_string)["password"]
  # The managed password may contain URL-structural characters (@, :, /, ...).
  # Percent-encode before embedding it in the connection string, otherwise
  # JupyterHub's urlparse fails with "Invalid IPv6 URL".
  db_password_encoded = replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(
    local.db_password,
  "%", "%25"), "@", "%40"), ":", "%3A"), "/", "%2F"), "?", "%3F"), "#", "%23"), "&", "%26"), "=", "%3D"), "[", "%5B"), "]", "%5D")
  db_url = "postgresql://${module.hub_db.username}:${local.db_password_encoded}@${module.hub_db.address}:${module.hub_db.port}/${module.hub_db.db_name}"
}
