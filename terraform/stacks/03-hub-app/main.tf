locals {
  hub_host = "notebook.${var.domain}"
}

# ---------------------------------------------------------------------------
# Auto-discovery of the 01-foundation resources. Kept for reference/debugging:
# the infra this stack depends on is read from the 02-platform remote state.
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
  vpc_id             = data.aws_subnet.one_private.vpc_id
  node_security_group_id = one(
    data.aws_security_groups.node.ids
  )
  oidc_url          = data.aws_eks_cluster.core.identity[0].oidc[0].issuer
  oidc_provider     = replace(local.oidc_url, "https://", "")
  oidc_provider_arn = "arn:aws:iam::${data.aws_caller_identity.current.account_id}:oidc-provider/${local.oidc_provider}"
}

# ---------------------------------------------------------------------------
# 02-platform remote state (infra owned by the platform stack)
# ---------------------------------------------------------------------------
# Everything infra-ish now lives in 02-platform: S3 workspace + IRSA role,
# RDS hub DB, Cognito user pool, the AWS Load Balancer Controller,
# the pre-created ALB + target group and the ACM certificate.
#
# This stack only consumes their outputs. The platform stack MUST be applied
# first - otherwise terraform_remote_state fails to find the state object.
data "terraform_remote_state" "platform" {
  backend = "s3"

  config = {
    bucket = var.state_bucket
    key    = var.state_key
    region = var.region
  }
}

# ---------------------------------------------------------------------------
# Service token used by the dashboard BFF to call the JupyterHub REST API.
# The value is retained in Terraform state and exported as a sensitive output
# for 04-dashboard; never commit or print it.
# ---------------------------------------------------------------------------
resource "random_password" "bff_api_token" {
  length  = 48
  special = false
}

# Bridge token: the Hub authenticator presents it to the BFF's /internal redeem endpoint to
# exchange a one-time dashboard handoff code for a Hub username. Shared with 04-dashboard.
resource "random_password" "hub_auth_bridge_token" {
  length  = 48
  special = false
}

# ---------------------------------------------------------------------------
# JupyterHub helm release
# ---------------------------------------------------------------------------
resource "helm_release" "jupyterhub" {
  name             = "jupyterhub"
  namespace        = "hub"
  create_namespace = true
  repository       = "https://hub.jupyter.org/helm-chart/"
  chart            = "jupyterhub"
  version          = var.z2jh_chart_version

  values = [templatefile("${path.module}/values/hub-values.yaml.tpl", {
    hub_db_url            = data.terraform_remote_state.platform.outputs.db_url
    cpu_image             = var.cpu_image
    gpu_image             = var.gpu_image
    hub_role_arn          = data.terraform_remote_state.platform.outputs.hub_role_arn
    hub_host              = local.hub_host
    cognito_issuer        = data.terraform_remote_state.platform.outputs.cognito_issuer
    cognito_client_id     = data.terraform_remote_state.platform.outputs.cognito_client_id
    cognito_client_secret = data.terraform_remote_state.platform.outputs.cognito_client_secret
    cognito_authorize_url = data.terraform_remote_state.platform.outputs.cognito_authorize_url
    cognito_token_url     = data.terraform_remote_state.platform.outputs.cognito_token_url
    cognito_userdata_url  = data.terraform_remote_state.platform.outputs.cognito_userdata_url
    vram_commit_mib       = var.vram_commit_mib
    vram_ceiling_mib      = var.vram_ceiling_mib
    enable_gpu_profiles   = var.enable_gpu_profiles
    bff_api_token         = random_password.bff_api_token.result
    bff_internal_url      = "http://bff.dashboard.svc.cluster.local:4000"
    hub_auth_bridge_token = random_password.hub_auth_bridge_token.result
    dashboard_login_url   = "https://${var.domain}/login"
  })]
}

# ---------------------------------------------------------------------------
# TargetGroupBinding: attach the public proxy Service to the pre-created target group
# ---------------------------------------------------------------------------
# The ALB + target group are created in 02-platform after 00-bootstrap has
# created the persistent DNS/ACM boundary. The chart's own Ingress block was
# removed from the values, therefore the TargetGroupBinding below attaches the
# public proxy to the pre-created target group.
#
# The TargetGroupBinding CRD ships with the AWS Load Balancer Controller
# (installed in 02-platform).
resource "kubectl_manifest" "hub_target_group_binding" {
  yaml_body = yamlencode({
    apiVersion = "elbv2.k8s.aws/v1beta1" # LB controller v3.x API group (not networking.k8s.aws)
    kind       = "TargetGroupBinding"
    metadata = {
      name      = "hub"
      namespace = "hub"
    }
    spec = {
      targetGroupARN = data.terraform_remote_state.platform.outputs.target_group_arn
      targetType     = "ip"
      vpcID          = data.terraform_remote_state.platform.outputs.vpc_id
      serviceRef = {
        name = var.target_service_name
        port = var.target_service_port
      }
    }
  })

  # The CRD is only guaranteed to exist once the LB controller is running
  # (02-platform). Skip the provider-side schema validation so a missing CRD
  # surfaces as a plain API error instead of an opaque validation failure.
  validate_schema = false

  depends_on = [helm_release.jupyterhub]
}

# ---------------------------------------------------------------------------
# Wait until the ACM certificate is ISSUED before creating the HTTPS listener
# ---------------------------------------------------------------------------
# The certificate is validated through CNAME records owned by 00-bootstrap in
# the delegated Route53 zone. Until the parent Cloudflare NS delegation is live,
# ACM stays in PENDING_VALIDATION and the listener creation fails. The wait uses
# the AWS CLI waiter, then fails loudly with the next action to take.
resource "terraform_data" "certificate_issued" {
  triggers_replace = {
    certificate_arn = data.terraform_remote_state.platform.outputs.certificate_arn
  }

  # The certificate is validated through CNAME records owned by 00-bootstrap in the
  # delegated Route53 zone. Until the parent NS delegation is live, ACM stays in
  # PENDING_VALIDATION and the listener creation fails. The AWS CLI waiter polls the
  # certificate until it is ISSUED and fails with a clear error when it never is.
  # No custom interpreter is used, so the same code runs on Linux, macOS and Windows.
  provisioner "local-exec" {
    command = "aws acm wait certificate-validated --certificate-arn ${data.terraform_remote_state.platform.outputs.certificate_arn} --region ${var.region}"
  }
}

# ---------------------------------------------------------------------------
# ALB listeners (the ALB itself is owned by 02-platform)
# ---------------------------------------------------------------------------
resource "aws_lb_listener" "https" {
  load_balancer_arn = data.terraform_remote_state.platform.outputs.alb_arn
  port              = 443
  protocol          = "HTTPS"
  ssl_policy        = "ELBSecurityPolicy-TLS13-1-2-2021-06"
  certificate_arn   = data.terraform_remote_state.platform.outputs.certificate_arn

  default_action {
    type             = "forward"
    target_group_arn = data.terraform_remote_state.platform.outputs.target_group_arn
  }

  # The certificate must be validated first; the TGB makes sure the target
  # group is attached to the ALB before we forward traffic to it.
  depends_on = [
    terraform_data.certificate_issued,
    kubectl_manifest.hub_target_group_binding,
  ]
}

resource "aws_lb_listener" "http" {
  load_balancer_arn = data.terraform_remote_state.platform.outputs.alb_arn
  port              = 80
  protocol          = "HTTP"

  default_action {
    type = "redirect"
    redirect {
      port        = "443"
      protocol    = "HTTPS"
      status_code = "HTTP_301"
    }
  }
}
