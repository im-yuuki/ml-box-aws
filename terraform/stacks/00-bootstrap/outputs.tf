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
