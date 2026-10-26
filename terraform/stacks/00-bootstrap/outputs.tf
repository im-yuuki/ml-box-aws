output "state_bucket" {
  description = "S3 bucket holding every stack's remote state. Auto-injected into the generated backend.hcl files - nothing to copy by hand."
  value       = aws_s3_bucket.state.id
}

output "lock_table" {
  description = "DynamoDB lock table for remote state, auto-injected into the generated backend.hcl files."
  value       = aws_dynamodb_table.lock.name
}

output "backend_files" {
  description = "backend.hcl files freshly generated for 01-foundation / 02-platform / 03-hub-app / 04-dashboard / 99-unverified-gpu. terraform init -backend-config=backend.hcl then just works."
  value       = { for f in local_file.stack_backends : f.filename => basename(dirname(f.filename)) }
}

output "route53_zone_id" {
  description = "Persistent Route53 hosted zone ID for the delegated mlbox.june8th.me subdomain."
  value       = aws_route53_zone.project.zone_id
}

output "route53_zone_nameservers" {
  description = "Nameservers to publish as the mlbox subdomain NS delegation in the parent Cloudflare zone."
  value       = aws_route53_zone.project.name_servers
}

output "notebook_certificate_arn" {
  description = "ACM certificate ARN for notebook.<domain>."
  value       = aws_acm_certificate.notebook.arn
}

output "notebook_certificate_status" {
  description = "ACM certificate status for notebook.<domain>."
  value       = aws_acm_certificate.notebook.status
}

output "dashboard_certificate_arn" {
  description = "ACM certificate ARN for the dashboard apex."
  value       = aws_acm_certificate.dashboard.arn
}

output "dashboard_certificate_status" {
  description = "ACM certificate status for the dashboard apex."
  value       = aws_acm_certificate.dashboard.status
}
