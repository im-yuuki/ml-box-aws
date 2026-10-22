output "user_pool_id" { value = aws_cognito_user_pool.hub.id }
output "client_id" { value = aws_cognito_user_pool_client.hub.id }
output "client_secret" {
  sensitive = true
  value     = aws_cognito_user_pool_client.hub.client_secret
}
output "issuer" { value = "https://cognito-idp.${data.aws_region.current.name}.amazonaws.com/${aws_cognito_user_pool.hub.id}" }
output "authorize_url" { value = "https://${aws_cognito_user_pool_domain.hub.domain}.auth.${data.aws_region.current.name}.amazoncognito.com/oauth2/authorize" }
output "token_url" { value = "https://${aws_cognito_user_pool_domain.hub.domain}.auth.${data.aws_region.current.name}.amazoncognito.com/oauth2/token" }
output "userdata_url" { value = "https://${aws_cognito_user_pool_domain.hub.domain}.auth.${data.aws_region.current.name}.amazoncognito.com/oauth2/userInfo" }
output "dashboard_client_id" { value = aws_cognito_user_pool_client.dashboard.id }
