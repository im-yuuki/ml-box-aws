# ALB (qua AWS LB Controller) + ACM miễn phí (DNS validate) + Route53.
# ALB thật do Ingress của hub tạo ở stack 03; module này lo controller + cert + zone.

locals {
  host         = "hub.${var.domain}"
  use_existing = var.route53_zone_id != ""
  zone_id      = local.use_existing ? var.route53_zone_id : aws_route53_zone.hub[0].zone_id
}

resource "aws_route53_zone" "hub" {
  count = local.use_existing ? 0 : 1
  name  = var.domain
  tags  = var.tags
}

resource "aws_acm_certificate" "hub" {
  domain_name       = local.host
  validation_method = "DNS"
  tags              = var.tags

  lifecycle {
    create_before_destroy = true
  }
}

resource "aws_route53_record" "validation" {
  for_each = {
    for dvo in aws_acm_certificate.hub.domain_validation_options : dvo.domain_name => {
      name   = dvo.resource_record_name
      record = dvo.resource_record_value
      type   = dvo.resource_record_type
    }
  }

  zone_id = local.zone_id
  name    = each.value.name
  type    = each.value.type
  records = [each.value.record]
  ttl     = 60
}

resource "aws_acm_certificate_validation" "hub" {
  certificate_arn         = aws_acm_certificate.hub.arn
  validation_record_fqdns = [for r in aws_route53_record.validation : r.fqdn]
}

# IAM policy chuẩn của controller, lấy đúng tag chart đang dùng.
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

# Record hub -> ALB. ALB do Ingress tạo nên apply lần 1 để trống, lần 2 điền DNS.
resource "aws_route53_record" "hub" {
  count   = var.alb_dns_name != "" ? 1 : 0
  zone_id = local.zone_id
  name    = local.host
  type    = "A"

  alias {
    name                   = var.alb_dns_name
    zone_id                = data.aws_elb_hosted_zone_id.current.id
    evaluate_target_health = true
  }
}
