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
# RDS hub DB, Cognito user pool, ECR repos, the AWS Load Balancer Controller,
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
  })]
}

# ---------------------------------------------------------------------------
# TargetGroupBinding: attach the public proxy Service to the pre-created target group
# ---------------------------------------------------------------------------
# The ALB + target group are created in 02-platform (so the operator can
# publish the CNAME and the ACM TXT record in one sitting). The chart's own
# Ingress block was removed from the values, therefore nothing would route
# traffic to the public proxy - the TargetGroupBinding below does that job.
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
# The certificate is validated with DNS TXT records that the operator has to
# publish at Cloudflare. Until then ACM stays in PENDING_VALIDATION and the
# listener creation fails. Poll for up to 15 minutes, then fail loudly with
# the next action to take.
resource "terraform_data" "certificate_issued" {
  triggers_replace = {
    certificate_arn = data.terraform_remote_state.platform.outputs.certificate_arn
  }

  provisioner "local-exec" {
    interpreter = ["/bin/bash", "-c"]
    command     = <<-EOT
      set -uo pipefail
      CERT_ARN="${data.terraform_remote_state.platform.outputs.certificate_arn}"
      REGION="${var.region}"
      MAX_ATTEMPTS=60   # 60 x 15s = 15 minutes

      for attempt in $(seq 1 "$${MAX_ATTEMPTS}"); do
        STATUS=$(aws acm describe-certificate \
          --certificate-arn "$${CERT_ARN}" \
          --region "$${REGION}" \
          --query 'Certificate.Status' \
          --output text 2>/dev/null || echo "UNKNOWN")

        echo "[attempt $${attempt}/$${MAX_ATTEMPTS}] certificate status: $${STATUS}"

        if [[ "$${STATUS}" == "ISSUED" ]]; then
          echo "certificate is ISSUED - continuing"
          exit 0
        fi

        if [[ "$${STATUS}" == "FAILED" || "$${STATUS}" == "VALIDATION_TIMED_OUT" || "$${STATUS}" == "REVOKED" ]]; then
          echo "ERROR: certificate $${CERT_ARN} reached terminal status $${STATUS}." >&2
          exit 1
        fi

        sleep 15
      done

      echo "ERROR: timed out after 15 minutes waiting for certificate $${CERT_ARN} to be ISSUED." >&2
      echo "The ACM certificate is still pending DNS validation. Publish the validation TXT records at Cloudflare, then re-run terraform apply in this stack." >&2
      echo "Get the records from the 02-platform stack:" >&2
      echo "  terraform -chdir=terraform/stacks/02-platform output certificate_validation_records" >&2
      exit 1
    EOT
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
