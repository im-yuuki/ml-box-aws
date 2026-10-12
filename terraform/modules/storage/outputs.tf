output "bucket" { value = aws_s3_bucket.workspace.id }
output "bucket_arn" { value = aws_s3_bucket.workspace.arn }
output "hub_role_arn" { value = aws_iam_role.hub.arn }
output "workspace_role_arn" { value = aws_iam_role.workspace.arn }
output "kms_key_arn" { value = aws_kms_key.workspace.arn }
