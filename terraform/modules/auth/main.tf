# Cognito User Pool + app client OIDC cho oauthenticator (claim email; plan/org
# bổ sung sau qua pre-token hook hoặc group mapping — lab dùng email trước).

data "aws_region" "current" {}

resource "aws_cognito_user_pool" "hub" {
  name                     = "${var.cluster_name}-hub"
  auto_verified_attributes = ["email"]
  username_attributes      = ["email"]

  # Lab: ai cũng tự đăng ký được (tạm thời). Prod chuyển true + duyệt tay.
  admin_create_user_config {
    allow_admin_create_user_only = false
  }

  account_recovery_setting {
    recovery_mechanism {
      name     = "verified_email"
      priority = 1
    }
  }

  tags = var.tags
}

resource "aws_cognito_user_pool_domain" "hub" {
  domain       = var.domain_prefix
  user_pool_id = aws_cognito_user_pool.hub.id
}

resource "aws_cognito_user_pool_client" "hub" {
  name            = "jupyterhub"
  user_pool_id    = aws_cognito_user_pool.hub.id
  generate_secret = true

  allowed_oauth_flows                  = ["code"]
  allowed_oauth_flows_user_pool_client = true
  allowed_oauth_scopes                 = ["openid", "email", "profile"]
  supported_identity_providers         = ["COGNITO"]

  callback_urls = [var.hub_callback_url]
  logout_urls   = [var.hub_logout_url]

  explicit_auth_flows = ["ALLOW_REFRESH_TOKEN_AUTH", "ALLOW_USER_SRP_AUTH"]
}
