locals {
  full_name = var.cluster_name
  hub_host  = "hub.${var.domain}"
}

module "storage" {
  source = "../../modules/storage"

  cluster_name      = var.cluster_name
  oidc_provider     = var.oidc_provider
  oidc_provider_arn = var.oidc_provider_arn
  tags              = var.tags
}

module "hub_db" {
  source = "../../modules/hub-db"

  cluster_name              = var.cluster_name
  vpc_id                    = var.vpc_id
  subnet_ids                = var.private_subnet_ids
  allowed_security_group_id = var.node_security_group_id
  tags                      = var.tags
}

module "auth" {
  source = "../../modules/auth"

  cluster_name     = var.cluster_name
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

module "ingress_dns" {
  source = "../../modules/ingress-dns"

  cluster_name      = var.cluster_name
  domain            = var.domain
  route53_zone_id   = var.route53_zone_id
  alb_dns_name      = var.alb_dns_name
  vpc_id            = var.vpc_id
  oidc_provider     = var.oidc_provider
  oidc_provider_arn = var.oidc_provider_arn
  tags              = var.tags
}

# Master password do RDS quản lý trong Secrets Manager (không hard-code).
data "aws_secretsmanager_secret_version" "db" {
  secret_id = module.hub_db.master_secret_arn
}

locals {
  db_password = jsondecode(data.aws_secretsmanager_secret_version.db.secret_string)["password"]
  db_url      = "postgresql://${module.hub_db.username}:${local.db_password}@${module.hub_db.address}:${module.hub_db.port}/${module.hub_db.db_name}"
}

resource "helm_release" "jupyterhub" {
  name             = "jupyterhub"
  namespace        = "hub"
  create_namespace = true
  repository       = "https://hub.jupyter.org/helm-chart/"
  chart            = "jupyterhub"
  version          = var.z2jh_chart_version

  values = [templatefile("${path.module}/values/hub-values.yaml.tpl", {
    hub_db_url            = local.db_url
    cpu_image             = var.cpu_image
    gpu_image             = var.gpu_image
    hub_role_arn          = module.storage.hub_role_arn
    hub_host              = local.hub_host
    cert_arn              = module.ingress_dns.certificate_arn
    cognito_issuer        = module.auth.issuer
    cognito_client_id     = module.auth.client_id
    cognito_client_secret = module.auth.client_secret
    cognito_authorize_url = module.auth.authorize_url
    cognito_token_url     = module.auth.token_url
    cognito_userdata_url  = module.auth.userdata_url
    vram_commit_mib       = var.vram_commit_mib
    vram_ceiling_mib      = var.vram_ceiling_mib
  })]

  depends_on = [module.ingress_dns]
}
