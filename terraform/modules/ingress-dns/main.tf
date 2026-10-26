# ALB + target group + security groups + Route53 aliases + LB controller.
# The persistent delegated project zone and ACM certificates are owned by 00-bootstrap.
# This module owns the current ALB, its target group, and aliases pointing at that ALB.
# The hub service is attached later through a TargetGroupBinding in 03-hub-app.

locals {
  host    = "notebook.${var.domain}"
  zone_id = var.manage_route53 ? var.route53_zone_id : ""
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
# this module. They live in the 03-hub-app stack, because the HTTPS listener can only
# be created once the ACM certificate is ISSUED. Persistent certificates and their
# validation records are owned by 00-bootstrap; the parent Cloudflare zone delegates
# the project subdomain to the Route53 zone created there.

# ---------------------------------------------------------------------------
# Certificate (free ACM, DNS validation)
# ---------------------------------------------------------------------------

# ACM certificates are persistent resources owned by 00-bootstrap. This stack
# consumes their ARNs and only owns ALB/DNS records tied to the current ALB.

# ---------------------------------------------------------------------------
# DNS - Route53 A-alias records for the current ALB
# ---------------------------------------------------------------------------

# The delegated zone and ACM validation records are owned by 00-bootstrap.
# This stack owns only aliases whose target is the ALB created below.
resource "aws_route53_record" "hub" {
  count   = var.manage_route53 ? 1 : 0
  zone_id = local.zone_id
  name    = local.host
  type    = "A"

  lifecycle {
    create_before_destroy = true
  }

  alias {
    name                   = aws_lb.hub.dns_name
    zone_id                = data.aws_elb_hosted_zone_id.current.id
    evaluate_target_health = true
  }
}

resource "aws_route53_record" "apex" {
  count   = var.manage_route53 ? 1 : 0
  zone_id = local.zone_id
  name    = var.domain
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
