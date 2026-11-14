# ---------------------------------------------------------------------------
# Remote state: 02-platform (VPC, ALB, zone, Cognito, database) + 03-hub-app (listener)
# ---------------------------------------------------------------------------
data "terraform_remote_state" "platform" {
  backend = "s3"
  config = {
    bucket = local.state_bucket
    key    = local.state_key
    region = var.region
  }
}

data "terraform_remote_state" "hub_app" {
  backend = "s3"
  config = {
    bucket = local.state_bucket
    key    = local.state_key_hub
    region = var.region
  }
}

data "aws_route53_zone" "project" {
  name         = var.domain
  private_zone = false
}

data "aws_lb" "alb" {
  arn = data.terraform_remote_state.platform.outputs.alb_arn
}

# Same credential source as the BFF. Only read when the database is enabled; the value is never an output.
data "aws_secretsmanager_secret_version" "database" {
  count     = var.enable_database ? 1 : 0
  secret_id = data.terraform_remote_state.platform.outputs.dashboard_usage_db_master_secret_arn
}

locals {
  # The state bucket and keys are account-agnostic here: the bucket is the one
  # 00-bootstrap created (same one as this stack's backend.hcl), the keys follow
  # the <env>/<region>/<stack>.tfstate rule when they are left empty.
  state_bucket  = var.state_bucket
  state_key     = var.state_key != "" ? var.state_key : "${var.env}/${var.region}/02-platform.tfstate"
  state_key_hub = var.state_key_hub_app != "" ? var.state_key_hub_app : "${var.env}/${var.region}/03-hub-app.tfstate"

  oidc_provider     = replace(data.aws_eks_cluster.core.identity[0].oidc[0].issuer, "https://", "")
  oidc_provider_arn = "arn:aws:iam::${data.aws_caller_identity.current.account_id}:oidc-provider/${local.oidc_provider}"

  db_password         = var.enable_database ? jsondecode(data.aws_secretsmanager_secret_version.database[0].secret_string)["password"] : ""
  db_password_encoded = replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(local.db_password, "%", "%25"), "@", "%40"), ":", "%3A"), "/", "%2F"), "?", "%3F"), "#", "%23"), "&", "%26"), "=", "%3D"), "[", "%5B"), "]", "%5D")
  database_url        = var.enable_database ? "postgresql://${data.terraform_remote_state.platform.outputs.dashboard_usage_db_username}:${local.db_password_encoded}@${data.terraform_remote_state.platform.outputs.dashboard_usage_db_address}:${data.terraform_remote_state.platform.outputs.dashboard_usage_db_port}/${data.terraform_remote_state.platform.outputs.dashboard_usage_db_name}" : ""

  cognito_user_pool_arn = "arn:aws:cognito-idp:${var.region}:${data.aws_caller_identity.current.account_id}:userpool/${data.terraform_remote_state.platform.outputs.cognito_user_pool_id}"

  health_targets = join(";", [
    "bff=http://bff.dashboard.svc.cluster.local:4000/v1/health",
    "dashboard=http://dashboard.dashboard.svc.cluster.local:3000/",
    "hub=http://proxy-public.hub.svc.cluster.local/hub/api",
    "site=https://${var.domain}/",
    "notebook=https://notebook.${var.domain}/hub/login",
  ])
}

resource "random_password" "session_secret" {
  length  = 48
  special = false
}

# ---------------------------------------------------------------------------
# IAM: read-only, assumed by the console pod through its ServiceAccount (IRSA). No access keys exist.
# Describe/List calls do not support resource-level restrictions, so Resource is "*". Nothing here can
# create, change or delete anything, and no data-plane access (S3 objects, database content) is granted.
# ---------------------------------------------------------------------------
resource "aws_iam_role" "admin" {
  name = "${local.cluster_name}-admin-console"
  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Federated = local.oidc_provider_arn }
      Action    = "sts:AssumeRoleWithWebIdentity"
      Condition = {
        StringEquals = {
          "${local.oidc_provider}:sub" = "system:serviceaccount:admin:admin-console"
          "${local.oidc_provider}:aud" = "sts.amazonaws.com"
        }
      }
    }]
  })
}

resource "aws_iam_role_policy" "admin_read_only" {
  name = "read-only-inventory"
  role = aws_iam_role.admin.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid    = "Inventory"
        Effect = "Allow"
        Action = [
          "eks:DescribeCluster",
          "eks:ListAddons",
          "eks:DescribeAddon",
          "ec2:DescribeInstances",
          "ec2:DescribeSubnets",
          "ec2:DescribeNatGateways",
          "ec2:DescribeVpcs",
          "elasticloadbalancing:DescribeLoadBalancers",
          "elasticloadbalancing:DescribeTargetGroups",
          "elasticloadbalancing:DescribeTargetHealth",
          "rds:DescribeDBInstances",
          "elasticfilesystem:DescribeFileSystems",
          "ec2:DescribeInstanceTypes",
          "servicequotas:GetServiceQuota",
          "s3:ListAllMyBuckets",
          "route53:ListHostedZonesByName",
          "route53:ListResourceRecordSets",
          "acm:ListCertificates",
          "acm:DescribeCertificate",
          "cognito-idp:DescribeUserPool",
        ]
        Resource = "*"
      },
    ]
  })
}

# Reads whether an account is locked. Limited to the user pool of the product.
resource "aws_iam_role_policy" "admin_cognito_read" {
  name = "cognito-read-user"
  role = aws_iam_role.admin.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect   = "Allow"
      Action   = ["cognito-idp:AdminGetUser"]
      Resource = local.cognito_user_pool_arn
    }]
  })
}

# The only write access of the console, and only when enable_actions is on: lock, unlock and sign out accounts of the
# product's user pool. It cannot create or delete users, change attributes or touch any other pool.
resource "aws_iam_role_policy" "admin_actions" {
  count = var.enable_actions ? 1 : 0

  name = "cognito-account-actions"
  role = aws_iam_role.admin.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect   = "Allow"
      Action   = ["cognito-idp:AdminDisableUser", "cognito-idp:AdminEnableUser", "cognito-idp:AdminUserGlobalSignOut"]
      Resource = local.cognito_user_pool_arn
    }]
  })
}

resource "aws_iam_role_policy" "admin_cost" {
  count = var.enable_cost_explorer ? 1 : 0

  name = "cost-explorer-read"
  role = aws_iam_role.admin.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect   = "Allow"
      Action   = ["ce:GetCostAndUsage"]
      Resource = "*"
    }]
  })
}

# ---------------------------------------------------------------------------
# DNS + certificate for the console host. The platform certificates only cover the apex and notebook hosts.
# ---------------------------------------------------------------------------
resource "aws_acm_certificate" "admin" {
  domain_name       = local.admin_host
  validation_method = "DNS"

  lifecycle {
    create_before_destroy = true
  }
}

resource "aws_route53_record" "admin_validation" {
  for_each = {
    for option in aws_acm_certificate.admin.domain_validation_options : option.domain_name => {
      name   = option.resource_record_name
      record = option.resource_record_value
      type   = option.resource_record_type
    }
  }

  zone_id         = data.aws_route53_zone.project.zone_id
  name            = each.value.name
  type            = each.value.type
  records         = [each.value.record]
  ttl             = 60
  allow_overwrite = true
}

resource "aws_acm_certificate_validation" "admin" {
  certificate_arn         = aws_acm_certificate.admin.arn
  validation_record_fqdns = [for record in aws_route53_record.admin_validation : record.fqdn]
}

resource "aws_route53_record" "admin" {
  zone_id = data.aws_route53_zone.project.zone_id
  name    = local.admin_host
  type    = "A"

  alias {
    name                   = data.aws_lb.alb.dns_name
    zone_id                = data.aws_lb.alb.zone_id
    evaluate_target_health = true
  }
}

# ---------------------------------------------------------------------------
# ALB: target group (port 5000) + security-group rules owned by 02-platform
# ---------------------------------------------------------------------------
resource "aws_lb_target_group" "admin" {
  name        = "admintg-${var.env}"
  port        = 5000
  protocol    = "HTTP"
  vpc_id      = data.terraform_remote_state.platform.outputs.vpc_id
  target_type = "ip"

  health_check {
    path                = "/healthz"
    matcher             = "200"
    healthy_threshold   = 2
    unhealthy_threshold = 3
    interval            = 30
    timeout             = 5
  }
}

resource "aws_vpc_security_group_egress_rule" "alb_egress_admin" {
  security_group_id            = data.terraform_remote_state.platform.outputs.alb_security_group_id
  description                  = "To the admin console pods (EKS nodes) on the console port"
  referenced_security_group_id = data.terraform_remote_state.platform.outputs.node_security_group_id
  from_port                    = aws_lb_target_group.admin.port
  to_port                      = aws_lb_target_group.admin.port
  ip_protocol                  = "tcp"
}

resource "aws_vpc_security_group_ingress_rule" "node_admin_ingress" {
  security_group_id            = data.terraform_remote_state.platform.outputs.node_security_group_id
  description                  = "Admin console traffic from the ALB"
  referenced_security_group_id = data.terraform_remote_state.platform.outputs.alb_security_group_id
  from_port                    = aws_lb_target_group.admin.port
  to_port                      = aws_lb_target_group.admin.port
  ip_protocol                  = "tcp"
}

resource "aws_lb_listener_certificate" "admin" {
  count = var.deploy_admin ? 1 : 0

  listener_arn    = data.terraform_remote_state.hub_app.outputs.https_listener_arn
  certificate_arn = aws_acm_certificate_validation.admin.certificate_arn
}

resource "aws_lb_listener_rule" "admin" {
  count = var.deploy_admin ? 1 : 0

  listener_arn = data.terraform_remote_state.hub_app.outputs.https_listener_arn
  priority     = 110

  action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.admin.arn
  }

  condition {
    host_header {
      values = [local.admin_host]
    }
  }

  dynamic "condition" {
    for_each = length(var.admin_allowed_cidrs) > 0 ? [1] : []
    content {
      source_ip {
        values = var.admin_allowed_cidrs
      }
    }
  }

  depends_on = [kubectl_manifest.tgb, aws_lb_listener_certificate.admin]
}

# ---------------------------------------------------------------------------
# Kubernetes: namespace, read-only cluster access, Secret, Deployment, Service, TGB
# ---------------------------------------------------------------------------
resource "kubectl_manifest" "namespace" {
  count = var.deploy_admin ? 1 : 0

  yaml_body = yamlencode({
    apiVersion = "v1"
    kind       = "Namespace"
    metadata   = { name = "admin" }
  })
}

resource "kubectl_manifest" "service_account" {
  count = var.deploy_admin ? 1 : 0

  yaml_body = yamlencode({
    apiVersion = "v1"
    kind       = "ServiceAccount"
    metadata = {
      name        = "admin-console"
      namespace   = "admin"
      annotations = { "eks.amazonaws.com/role-arn" = aws_iam_role.admin.arn }
    }
  })

  depends_on = [kubectl_manifest.namespace]
}

# Cluster-wide read access, limited to the kinds the console shows. No secrets, no configmaps, no write verbs.
resource "kubectl_manifest" "cluster_role" {
  count = var.deploy_admin ? 1 : 0

  yaml_body = yamlencode({
    apiVersion = "rbac.authorization.k8s.io/v1"
    kind       = "ClusterRole"
    metadata   = { name = "admin-console-read" }
    rules = [
      {
        apiGroups = [""]
        resources = ["nodes", "pods", "events", "persistentvolumeclaims", "namespaces"]
        verbs     = ["get", "list"]
      },
      {
        apiGroups = ["apps"]
        resources = ["deployments", "statefulsets", "daemonsets"]
        verbs     = ["get", "list"]
      },
      {
        apiGroups = ["karpenter.sh"]
        resources = ["nodepools", "nodeclaims"]
        verbs     = ["get", "list"]
      },
    ]
  })
}

resource "kubectl_manifest" "cluster_role_binding" {
  count = var.deploy_admin ? 1 : 0

  yaml_body = yamlencode({
    apiVersion = "rbac.authorization.k8s.io/v1"
    kind       = "ClusterRoleBinding"
    metadata   = { name = "admin-console-read" }
    roleRef = {
      apiGroup = "rbac.authorization.k8s.io"
      kind     = "ClusterRole"
      name     = "admin-console-read"
    }
    subjects = [{
      kind      = "ServiceAccount"
      name      = "admin-console"
      namespace = "admin"
    }]
  })

  depends_on = [kubectl_manifest.cluster_role, kubectl_manifest.service_account]
}

resource "kubectl_manifest" "secret" {
  count = var.deploy_admin ? 1 : 0

  yaml_body = yamlencode({
    apiVersion = "v1"
    kind       = "Secret"
    metadata   = { name = "admin-config", namespace = "admin" }
    type       = "Opaque"
    stringData = {
      ADMIN_PASSWORD_HASH  = var.admin_password_hash
      ADMIN_SESSION_SECRET = random_password.session_secret.result
      APP_DATABASE_URL     = local.database_url
      # The Hub service token is only given to the console when changes are on; it can stop any notebook server.
      HUB_API_TOKEN = var.enable_actions ? data.terraform_remote_state.hub_app.outputs.bff_api_token : ""
    }
  })

  depends_on = [kubectl_manifest.namespace]
}

resource "kubectl_manifest" "deployment" {
  count = var.deploy_admin ? 1 : 0

  yaml_body = yamlencode({
    apiVersion = "apps/v1"
    kind       = "Deployment"
    metadata = {
      name      = "admin-console"
      namespace = "admin"
      labels    = { app = "admin-console" }
    }
    spec = {
      # One replica on purpose: the login lockout and the admin action log live in process memory.
      replicas = 1
      selector = { matchLabels = { app = "admin-console" } }
      template = {
        metadata = { labels = { app = "admin-console" } }
        spec = {
          serviceAccountName = "admin-console"
          securityContext    = { runAsNonRoot = true, runAsUser = 1001 }
          containers = [{
            name  = "admin-console"
            image = var.admin_image
            ports = [{ containerPort = 5000, protocol = "TCP" }]
            env = [
              { name = "PORT", value = "5000" },
              { name = "HOST", value = "0.0.0.0" },
              { name = "ADMIN_USERNAME", value = var.admin_username },
              { name = "AWS_REGION", value = var.region },
              { name = "CLUSTER_NAME", value = local.cluster_name },
              { name = "PROJECT_PREFIX", value = var.project },
              { name = "DOMAIN", value = var.domain },
              { name = "COGNITO_USER_POOL_ID", value = data.terraform_remote_state.platform.outputs.cognito_user_pool_id },
              { name = "DATABASE_CA_PATH", value = "/etc/ssl/certs/rds-ca-bundle.pem" },
              { name = "ENABLE_COST_EXPLORER", value = tostring(var.enable_cost_explorer) },
              { name = "ADMIN_ACTIONS_ENABLED", value = tostring(var.enable_actions) },
              { name = "HUB_URL", value = "http://proxy-public.hub.svc.cluster.local" },
              { name = "HEALTH_TARGETS", value = local.health_targets },
              { name = "SECURE_COOKIES", value = "true" },
            ]
            envFrom        = [{ secretRef = { name = "admin-config" } }]
            readinessProbe = { httpGet = { path = "/healthz", port = 5000 }, initialDelaySeconds = 5, periodSeconds = 10 }
            livenessProbe  = { httpGet = { path = "/healthz", port = 5000 }, initialDelaySeconds = 15, periodSeconds = 20 }
            resources = {
              requests = { cpu = "50m", memory = "128Mi" }
              limits   = { cpu = "500m", memory = "384Mi" }
            }
            securityContext = { allowPrivilegeEscalation = false, readOnlyRootFilesystem = true, capabilities = { drop = ["ALL"] } }
          }]
        }
      }
    }
  })

  depends_on = [kubectl_manifest.secret, kubectl_manifest.service_account, kubectl_manifest.cluster_role_binding]
}

resource "kubectl_manifest" "service" {
  count = var.deploy_admin ? 1 : 0

  yaml_body = yamlencode({
    apiVersion = "v1"
    kind       = "Service"
    metadata   = { name = "admin-console", namespace = "admin", labels = { app = "admin-console" } }
    spec = {
      selector = { app = "admin-console" }
      ports    = [{ port = 5000, targetPort = 5000, protocol = "TCP" }]
    }
  })

  depends_on = [kubectl_manifest.namespace]
}

resource "kubectl_manifest" "tgb" {
  count = var.deploy_admin ? 1 : 0

  yaml_body = yamlencode({
    apiVersion = "elbv2.k8s.aws/v1beta1"
    kind       = "TargetGroupBinding"
    metadata   = { name = "admin-console", namespace = "admin" }
    spec = {
      targetGroupARN = aws_lb_target_group.admin.arn
      targetType     = "ip"
      vpcID          = data.terraform_remote_state.platform.outputs.vpc_id
      serviceRef     = { name = "admin-console", port = 5000 }
    }
  })

  validate_schema = false

  depends_on = [kubectl_manifest.service]
}
