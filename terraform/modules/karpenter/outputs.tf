output "namespace" { value = local.namespace }
output "interruption_queue_arn" { value = aws_sqs_queue.interruption.arn }
output "role_arn" { value = aws_iam_role.karpenter.arn }
output "node_role_name" { value = aws_iam_role.node.name }
output "node_role_arn" { value = aws_iam_role.node.arn }
output "node_instance_profile" { value = aws_iam_instance_profile.node.name }
