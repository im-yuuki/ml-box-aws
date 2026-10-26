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

locals {
  private_subnet_ids = data.aws_subnets.private.ids
  public_subnet_ids  = data.aws_subnets.public.ids
  vpc_id             = data.aws_subnet.one_private.vpc_id
  node_security_group_id = one(
    data.aws_security_groups.node.ids
  )
  oidc_url          = data.aws_eks_cluster.core.identity[0].oidc[0].issuer
  oidc_provider     = replace(local.oidc_url, "https://", "")
  oidc_provider_arn = "arn:aws:iam::${data.aws_caller_identity.current.account_id}:oidc-provider/${local.oidc_provider}"
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

module "auth" {
  source = "../../modules/auth"

  cluster_name     = local.cluster_name
  domain_prefix    = var.cognito_domain_prefix
  hub_callback_url = "https://${local.hub_host}/hub/oauth_callback"
  hub_logout_url   = "https://${local.hub_host}/"
  tags             = var.tags
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
