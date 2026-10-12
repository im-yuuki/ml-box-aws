# EventBridge -> SQS: Karpenter nhận tín hiệu gián đoạn để dọn node (chủ yếu cho pool cpu-user Spot).
# Bộ 4 rule chuẩn theo doc interruption handling của Karpenter.

locals {
  interruption_events = {
    spot_interruption = {
      source      = ["aws.ec2"]
      detail_type = ["EC2 Spot Instance Interruption Warning"]
    }
    rebalance = {
      source      = ["aws.ec2"]
      detail_type = ["EC2 Instance Rebalance Recommendation"]
    }
    state_change = {
      source      = ["aws.ec2"]
      detail_type = ["EC2 Instance State-change Notification"]
    }
    scheduled_change = {
      source      = ["aws.health"]
      detail_type = ["AWS Health Event"]
    }
    capacity_reservation = {
      source      = ["aws.ec2"]
      detail_type = ["EC2 Capacity Reservation Instance Interruption Warning"]
    }
  }
}

resource "aws_cloudwatch_event_rule" "interruption" {
  for_each = local.interruption_events

  name        = "${var.cluster_name}-karpenter-${each.key}"
  description = "Karpenter interruption: ${each.key}"
  event_pattern = jsonencode({
    source      = each.value.source
    detail-type = each.value.detail_type
  })
  tags = var.tags
}

resource "aws_cloudwatch_event_target" "interruption" {
  for_each = local.interruption_events

  rule = aws_cloudwatch_event_rule.interruption[each.key].name
  arn  = aws_sqs_queue.interruption.arn
}

resource "aws_sqs_queue_policy" "interruption" {
  queue_url = aws_sqs_queue.interruption.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Sid       = "AllowEventBridge"
      Effect    = "Allow"
      Principal = { Service = "events.amazonaws.com" }
      Action    = "sqs:SendMessage"
      Resource  = aws_sqs_queue.interruption.arn
      Condition = {
        StringEquals = {
          "aws:SourceAccount" = data.aws_caller_identity.current.account_id
        }
      }
    }]
  })
}
