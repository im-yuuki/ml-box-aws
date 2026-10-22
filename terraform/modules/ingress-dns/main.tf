# ALB + target group + security groups + free ACM (DNS validation) + LB controller.
# The hub's Kubernetes Ingress no longer creates the ALB: this module owns it, so the public
# DNS name and the TLS certificate exist BEFORE the operator points DNS (Cloudflare) at it.
# The hub service is attached to the target group later, via a TargetGroupBinding
# (separate stack) - the LB controller helm release below is what reconciles that CRD.
#
# DNS modes:
# - manage_route53 = false (default): DNS is managed by hand (Cloudflare). No Route53
#   resource is created; the module only outputs the ACM TXT record the operator publishes.
# - manage_route53 = true: the zone lives in Route53, Terraform owns the ACM validation
#   TXT records + the A-alias record pointing at the ALB created here.

locals {
  host = "hub.${var.domain}"

  # Route53 mode: the zone is either an existing one (route53_zone_id) or created here.
  use_existing_zone = var.manage_route53 && var.route53_zone_id != ""
  zone_id = var.manage_route53 ? (
    var.route53_zone_id != "" ? var.route53_zone_id : try(aws_route53_zone.hub[0].zone_id, "")
  ) : ""
}

# ---------------------------------------------------------------------------
# Security groups
# ---------------------------------------------------------------------------

# ALB SG: public 80/443 in, egress to the EKS nodes (hub pods) on the proxy port only.
resource "aws_security_group" "alb" {
  name        = "${var.cluster_name}-alb"
  description = "Hub ALB (internet-facing)"
  vpc_id      = var.vpc_id
  tags        = var.tags
}

# Rules are standalone resources (not inline blocks) so the SG can be edited by other
# stacks without conflicting with the rules below. aws_vpc_security_group_ingress_rule /
# _egress_rule are the resources the AWS provider recommends (the old aws_security_group_rule
# is deprecated and was dropped in the v5 provider line).
resource "aws_vpc_security_group_ingress_rule" "alb_http" {
  security_group_id = aws_security_group.alb.id
  description       = "HTTP from the internet"
  cidr_ipv4         = "0.0.0.0/0"
  from_port         = 80
  to_port           = 80
  ip_protocol       = "tcp"
}

resource "aws_vpc_security_group_ingress_rule" "alb_https" {
  security_group_id = aws_security_group.alb.id
  description       = "HTTPS from the internet"
  cidr_ipv4         = "0.0.0.0/0"
  from_port         = 443
  to_port           = 443
  ip_protocol       = "tcp"
}

# Egress: only towards the pods. Referencing a SG (instead of a CIDR) also drops the
# default allow-all egress of the ALB SG.
resource "aws_vpc_security_group_egress_rule" "alb_egress_proxy" {
  security_group_id            = aws_security_group.alb.id
  description                  = "To the hub pods (EKS nodes) on the proxy port"
  referenced_security_group_id = var.node_security_group_id
  from_port                    = var.proxy_port
  to_port                      = var.proxy_port
  ip_protocol                  = "tcp"
}

# Node SG (EKS) side: the hub proxy pods live behind the node SG (VPC CNI primary ENI),
# so this rule covers the pod IPs as well.
resource "aws_vpc_security_group_ingress_rule" "node_proxy_ingress" {
  security_group_id            = var.node_security_group_id
  description                  = "Hub proxy traffic from the ALB"
  referenced_security_group_id = aws_security_group.alb.id
  from_port                    = var.proxy_port
  to_port                      = var.proxy_port
  ip_protocol                  = "tcp"
}

# ---------------------------------------------------------------------------
# ALB + target group
# ---------------------------------------------------------------------------

resource "aws_lb" "hub" {
  name_prefix        = "hub-"
  internal           = false
  load_balancer_type = "application"
  subnets            = var.subnet_ids
  security_groups    = [aws_security_group.alb.id]

  drop_invalid_header_fields = true
  idle_timeout               = 3600  # JupyterHub holds long-lived websockets (terminals, /lab API)
  enable_deletion_protection = false # lab: destroy must work

  tags = var.tags
}

resource "aws_lb_target_group" "hub" {
  name_prefix = "hubtg-" # name_prefix is limited to 6 characters by the provider
  port        = var.target_group_port
  protocol    = "HTTP"
  target_type = "ip" # pods, not nodes (VPC CNI)
  vpc_id      = var.vpc_id

  deregistration_delay = 30

  health_check {
    path                = var.health_check_path
    matcher             = "200-399"
    interval            = 30
    timeout             = 5
    healthy_threshold   = 2
    unhealthy_threshold = 3
  }

  tags = var.tags
}

# NOTE: the ALB listeners (80 -> 443 redirect, 443 -> target group) are NOT owned by
# this module. They live in the 04-hub-app stack, because the HTTPS listener can only
# be created once the ACM certificate is ISSUED, which requires the operator to
# publish the DNS validation record first (manual Cloudflare mode).

# ---------------------------------------------------------------------------
# Certificate (free ACM, DNS validation)
# ---------------------------------------------------------------------------

resource "aws_acm_certificate" "hub" {
  domain_name       = local.host
  validation_method = "DNS"
  tags              = var.tags

  lifecycle {
    create_before_destroy = true
  }
}

# ---------------------------------------------------------------------------
# DNS - Route53 mode only (manage_route53 = true)
# ---------------------------------------------------------------------------

resource "aws_route53_zone" "hub" {
  count = var.manage_route53 && var.route53_zone_id == "" ? 1 : 0
  name  = var.domain
  tags  = var.tags
}

# ACM validation TXT records inside the zone.
resource "aws_route53_record" "validation" {
  for_each = var.manage_route53 ? {
    for dvo in aws_acm_certificate.hub.domain_validation_options : dvo.domain_name => {
      name   = dvo.resource_record_name
      record = dvo.resource_record_value
      type   = dvo.resource_record_type
    }
  } : {}

  zone_id = local.zone_id
  name    = each.value.name
  type    = each.value.type
  records = [each.value.record]
  ttl     = 60
}

# Waits until ACM validated the certificate (only possible when we own the records).
# Opt-in: with an NS delegation the zone only becomes authoritative AFTER the
# operator points the nameservers at Route53, so this resource would just block
# the apply for its full timeout. ACM issues the certificate on its own as soon
# as the TXT record is resolvable; the hub-app stack polls for the ISSUED state.
resource "aws_acm_certificate_validation" "hub" {
  count = var.manage_route53 && var.validate_certificate ? 1 : 0

  certificate_arn         = aws_acm_certificate.hub.arn
  validation_record_fqdns = [for r in aws_route53_record.validation : r.fqdn]
}

# Hub record -> the ALB created by this module.
resource "aws_route53_record" "hub" {
  count   = var.manage_route53 ? 1 : 0
  zone_id = local.zone_id
  name    = local.host
  type    = "A"

  alias {
    name                   = aws_lb.hub.dns_name
    zone_id                = data.aws_elb_hosted_zone_id.current.id
    evaluate_target_health = true
  }
}

# ---------------------------------------------------------------------------
# LB controller (IRSA role + policy + chart) - needed to reconcile the
# TargetGroupBinding that attaches the hub service to the target group above.
# ---------------------------------------------------------------------------

# Controller's standard IAM policy, taken exactly from the chart version in use.
data "http" "lb_controller_policy" {
  url = "https://raw.githubusercontent.com/kubernetes-sigs/aws-load-balancer-controller/v${var.lb_controller_chart_version}/docs/install/iam_policy.json"
}

resource "aws_iam_role" "lb_controller" {
  name = "${var.cluster_name}-lb-controller"
  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Federated = var.oidc_provider_arn }
      Action    = "sts:AssumeRoleWithWebIdentity"
      Condition = {
        StringEquals = {
          "${var.oidc_provider}:sub" = "system:serviceaccount:kube-system:aws-load-balancer-controller"
        }
      }
    }]
  })
  tags = var.tags
}

resource "aws_iam_policy" "lb_controller" {
  name   = "${var.cluster_name}-lb-controller"
  policy = data.http.lb_controller_policy.response_body
  tags   = var.tags
}

resource "aws_iam_role_policy_attachment" "lb_controller" {
  role       = aws_iam_role.lb_controller.name
  policy_arn = aws_iam_policy.lb_controller.arn
}

resource "helm_release" "lb_controller" {
  name       = "aws-load-balancer-controller"
  namespace  = "kube-system"
  repository = "https://aws.github.io/eks-charts"
  chart      = "aws-load-balancer-controller"
  version    = var.lb_controller_chart_version

  values = [yamlencode({
    clusterName = var.cluster_name
    region      = data.aws_region.current.name
    vpcId       = var.vpc_id
    serviceAccount = {
      create = true
      name   = "aws-load-balancer-controller"
      annotations = {
        "eks.amazonaws.com/role-arn" = aws_iam_role.lb_controller.arn
      }
    }
  })]

  depends_on = [aws_iam_role_policy_attachment.lb_controller]
}

data "aws_region" "current" {}
data "aws_elb_hosted_zone_id" "current" {}
