# Cognito User Pool + OIDC app client for oauthenticator (claims email; plan/org
# added later via pre-token hook or group mapping — lab uses email first).

data "aws_region" "current" {}

resource "aws_cognito_user_pool" "hub" {
  name                     = "${var.cluster_name}-hub"
  auto_verified_attributes = ["email"]
  username_attributes      = ["email"]

  # Lab: anyone can self-register (temporary). Prod switches to true + manual approval.
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

# Dashboard public client (SRP/OTP from the browser, no client secret).
# No OAuth flows: the dashboard talks to Cognito directly, not via Hosted UI.
resource "aws_cognito_user_pool_client" "dashboard" {
  name            = "dashboard"
  user_pool_id    = aws_cognito_user_pool.hub.id
  generate_secret = false

  explicit_auth_flows = [
    "ALLOW_USER_SRP_AUTH",
    "ALLOW_USER_AUTH",
    "ALLOW_USER_PASSWORD_AUTH",
    "ALLOW_REFRESH_TOKEN_AUTH",
  ]
}
