output "state_bucket" {
  description = "Điền vào bucket trong backend.hcl của stack 01/02/03."
  value       = aws_s3_bucket.state.id
}

output "lock_table" {
  description = "Điền vào dynamodb_table trong backend.hcl của stack 01/02/03."
  value       = aws_dynamodb_table.lock.name
}

output "backend_hint" {
  description = "Mẫu backend.hcl sau khi bootstrap xong."
  value       = <<-EOT
    bucket         = "${aws_s3_bucket.state.id}"
    key            = "dev/ap-southeast-2/01-foundation.tfstate"
    region         = "ap-southeast-2"
    dynamodb_table = "${aws_dynamodb_table.lock.name}"
    encrypt        = true
  EOT
}
