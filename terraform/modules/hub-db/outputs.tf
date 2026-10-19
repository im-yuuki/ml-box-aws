output "address" { value = aws_db_instance.hub.address }
output "port" { value = aws_db_instance.hub.port }
output "db_name" { value = aws_db_instance.hub.db_name }
output "username" { value = aws_db_instance.hub.username }
output "master_secret_arn" {
  description = "Secrets Manager ARN holding the master password (RDS-managed)."
  value       = aws_db_instance.hub.master_user_secret[0].secret_arn
}
