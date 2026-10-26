# ---------------------------------------------------------------------------
# Remote state: 02-platform (ALB, ACM, Cognito, VPC) + 03-hub-app (listener)
# ---------------------------------------------------------------------------
data "terraform_remote_state" "platform" {
  backend = "s3"

  config = {
    bucket = var.state_bucket
    key    = var.state_key
    region = var.region
  }
}

data "terraform_remote_state" "hub_app" {
  backend = "s3"

  config = {
    bucket = var.state_bucket
    key    = var.state_key_hub_app
    region = var.region
  }
}

# ---------------------------------------------------------------------------
# ECR repositories (dashboard + bff)
# ---------------------------------------------------------------------------
resource "aws_ecr_repository" "this" {
  for_each = toset(["dashboard", "bff"])

  name                 = "${var.project}/${each.value}"
  image_tag_mutability = "IMMUTABLE"

  image_scanning_configuration {
    scan_on_push = true
  }

  tags = var.tags
}

# The session key is generated in Terraform and stored only in the Kubernetes
# Secret below. It is also retained in Terraform state, which must stay in the
# encrypted/locked bootstrap backend.
resource "random_password" "bff_session_secret" {
  length  = 48
  special = false
}

# ---------------------------------------------------------------------------
# Target group for the dashboard (ip mode, port 3000)
# ---------------------------------------------------------------------------
resource "aws_lb_target_group" "dashboard" {
  name        = "dashtg-${var.env}"
  port        = 3000
  protocol    = "HTTP"
  vpc_id      = data.terraform_remote_state.platform.outputs.vpc_id
  target_type = "ip"

  health_check {
    path                = "/"
    matcher             = "200-399"
    healthy_threshold   = 2
    unhealthy_threshold = 3
    interval            = 30
    timeout             = 5
  }

  tags = var.tags
}

# ---------------------------------------------------------------------------
# Security groups: ALB <-> dashboard pods (port 3000)
# The SGs are owned by 02-platform (ingress-dns module); its rules are
# standalone resources precisely so other stacks can add their own.
# ---------------------------------------------------------------------------
resource "aws_vpc_security_group_egress_rule" "alb_egress_dashboard" {
  security_group_id            = data.terraform_remote_state.platform.outputs.alb_security_group_id
  description                  = "To the dashboard pods (EKS nodes) on the dashboard port"
  referenced_security_group_id = data.terraform_remote_state.platform.outputs.node_security_group_id
  from_port                    = aws_lb_target_group.dashboard.port
  to_port                      = aws_lb_target_group.dashboard.port
  ip_protocol                  = "tcp"
}

resource "aws_vpc_security_group_ingress_rule" "node_dashboard_ingress" {
  security_group_id            = data.terraform_remote_state.platform.outputs.node_security_group_id
  description                  = "Dashboard traffic from the ALB"
  referenced_security_group_id = data.terraform_remote_state.platform.outputs.alb_security_group_id
  from_port                    = aws_lb_target_group.dashboard.port
  to_port                      = aws_lb_target_group.dashboard.port
  ip_protocol                  = "tcp"
}

# ---------------------------------------------------------------------------
# Kubernetes: namespace + dashboard/BFF Deployments + Services + TGB
# ---------------------------------------------------------------------------
resource "kubectl_manifest" "namespace" {
  count = var.deploy_dashboard ? 1 : 0

  yaml_body = yamlencode({
    apiVersion = "v1"
    kind       = "Namespace"
    metadata = {
      name = "dashboard"
    }
  })
}

resource "kubectl_manifest" "deployment" {
  count = var.deploy_dashboard ? 1 : 0

  yaml_body = yamlencode({
    apiVersion = "apps/v1"
    kind       = "Deployment"
    metadata = {
      name      = "dashboard"
      namespace = "dashboard"
      labels    = { app = "dashboard" }
    }
    spec = {
      replicas = var.dashboard_replicas
      selector = {
        matchLabels = { app = "dashboard" }
      }
      template = {
        metadata = {
          labels = { app = "dashboard" }
        }
        spec = {
          containers = [{
            name  = "dashboard"
            image = var.dashboard_image
            ports = [{
              containerPort = 3000
              protocol      = "TCP"
            }]
            env = [
              { name = "NODE_ENV", value = "production" },
              { name = "PORT", value = "3000" },
              { name = "BFF_INTERNAL_URL", value = "http://bff:4000" },
              { name = "NEXT_PUBLIC_COGNITO_REGION", value = var.region },
              { name = "NEXT_PUBLIC_COGNITO_USER_POOL_ID", value = data.terraform_remote_state.platform.outputs.cognito_user_pool_id },
              { name = "NEXT_PUBLIC_COGNITO_CLIENT_ID", value = data.terraform_remote_state.platform.outputs.cognito_dashboard_client_id },
            ]
            resources = {
              requests = {
                cpu    = "100m"
                memory = "128Mi"
              }
              limits = {
                cpu    = "500m"
                memory = "512Mi"
              }
            }
          }]
        }
      }
    }
  })

  depends_on = [kubectl_manifest.namespace]
}

resource "kubectl_manifest" "bff_secret" {
  count = var.deploy_dashboard ? 1 : 0

  yaml_body = yamlencode({
    apiVersion = "v1"
    kind       = "Secret"
    metadata = {
      name      = "bff-config"
      namespace = "dashboard"
    }
    type = "Opaque"
    stringData = {
      BFF_SESSION_SECRET = random_password.bff_session_secret.result
      HUB_API_TOKEN      = data.terraform_remote_state.hub_app.outputs.bff_api_token
    }
  })

  depends_on = [kubectl_manifest.namespace]
}

resource "kubectl_manifest" "bff_deployment" {
  count = var.deploy_dashboard ? 1 : 0

  yaml_body = yamlencode({
    apiVersion = "apps/v1"
    kind       = "Deployment"
    metadata = {
      name      = "bff"
      namespace = "dashboard"
      labels    = { app = "bff" }
    }
    spec = {
      replicas = var.bff_replicas
      selector = {
        matchLabels = { app = "bff" }
      }
      template = {
        metadata = {
          labels = { app = "bff" }
        }
        spec = {
          containers = [{
            name  = "bff"
            image = var.bff_image
            ports = [{ containerPort = 4000, protocol = "TCP" }]
            env = [
              { name = "PORT", value = "4000" },
              { name = "HOST", value = "0.0.0.0" },
              { name = "AWS_REGION", value = var.region },
              { name = "COGNITO_USER_POOL_ID", value = data.terraform_remote_state.platform.outputs.cognito_user_pool_id },
              { name = "COGNITO_CLIENT_ID", value = data.terraform_remote_state.platform.outputs.cognito_dashboard_client_id },
              { name = "HUB_URL", value = "http://proxy-public.hub.svc.cluster.local" },
              { name = "SECURE_COOKIES", value = tostring(var.bff_secure_cookies) },
            ]
            envFrom = [{
              secretRef = { name = "bff-config" }
            }]
            readinessProbe = {
              httpGet             = { path = "/v1/health", port = 4000 }
              initialDelaySeconds = 5
              periodSeconds       = 10
            }
            livenessProbe = {
              httpGet             = { path = "/v1/health", port = 4000 }
              initialDelaySeconds = 15
              periodSeconds       = 20
            }
            resources = {
              requests = { cpu = "100m", memory = "128Mi" }
              limits   = { cpu = "500m", memory = "512Mi" }
            }
          }]
        }
      }
    }
  })

  depends_on = [kubectl_manifest.bff_secret]
}

resource "kubectl_manifest" "bff_service" {
  count = var.deploy_dashboard ? 1 : 0

  yaml_body = yamlencode({
    apiVersion = "v1"
    kind       = "Service"
    metadata = {
      name      = "bff"
      namespace = "dashboard"
      labels    = { app = "bff" }
    }
    spec = {
      selector = { app = "bff" }
      ports    = [{ port = 4000, targetPort = 4000, protocol = "TCP" }]
    }
  })

  depends_on = [kubectl_manifest.namespace]
}

resource "kubectl_manifest" "service" {
  count = var.deploy_dashboard ? 1 : 0

  yaml_body = yamlencode({
    apiVersion = "v1"
    kind       = "Service"
    metadata = {
      name      = "dashboard"
      namespace = "dashboard"
      labels    = { app = "dashboard" }
    }
    spec = {
      selector = { app = "dashboard" }
      ports = [{
        port       = 3000
        targetPort = 3000
        protocol   = "TCP"
      }]
    }
  })

  depends_on = [kubectl_manifest.namespace]
}

resource "kubectl_manifest" "tgb" {
  count = var.deploy_dashboard ? 1 : 0

  yaml_body = yamlencode({
    apiVersion = "elbv2.k8s.aws/v1beta1"
    kind       = "TargetGroupBinding"
    metadata = {
      name      = "dashboard"
      namespace = "dashboard"
    }
    spec = {
      targetGroupARN = aws_lb_target_group.dashboard.arn
      targetType     = "ip"
      vpcID          = data.terraform_remote_state.platform.outputs.vpc_id
      serviceRef = {
        name = "dashboard"
        port = 3000
      }
    }
  })

  validate_schema = false

  depends_on = [kubectl_manifest.service]
}

# ---------------------------------------------------------------------------
# ALB: host-header rule (apex → dashboard TG) + apex cert on the listener
# ---------------------------------------------------------------------------
resource "aws_lb_listener_rule" "dashboard" {
  count = var.deploy_dashboard ? 1 : 0

  listener_arn = data.terraform_remote_state.hub_app.outputs.https_listener_arn
  priority     = 100

  action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.dashboard.arn
  }

  condition {
    host_header {
      values = [var.domain]
    }
  }

  depends_on = [kubectl_manifest.tgb]
}

resource "aws_lb_listener_certificate" "apex" {
  count = var.deploy_dashboard ? 1 : 0

  listener_arn    = data.terraform_remote_state.hub_app.outputs.https_listener_arn
  certificate_arn = data.terraform_remote_state.platform.outputs.apex_certificate_arn
}
