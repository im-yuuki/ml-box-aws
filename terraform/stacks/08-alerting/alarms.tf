# CloudWatch alarms (native metrics, no agent needed). All actions -> SNS alerts topic.
variable "rds_hub_identifier" {
  type    = string
  default = "jhub-gpu-sandbox-dev-apse2-hub"
}

variable "rds_usage_identifier" {
  type    = string
  default = "jhub-gpu-sandbox-dev-apse2-dashboard-usage"
}

locals {
  rds_identifiers = {
    hub   = var.rds_hub_identifier
    usage = var.rds_usage_identifier
  }
}

# --- ALB target groups (hub notebook proxy + dashboard) ---

resource "aws_cloudwatch_metric_alarm" "hub_unhealthy" {
  alarm_name          = "${var.project}-${var.env}-${local.region_short}-hub-tg-unhealthy"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 5
  metric_name         = "UnHealthyHostCount"
  namespace           = "AWS/ApplicationELB"
  period              = 60
  statistic           = "Maximum"
  threshold           = 0
  alarm_description   = "Hub target group has unhealthy targets for 5 minutes. Check TGB/namespace."
  treat_missing_data  = "notBreaching"
  dimensions          = { TargetGroup = data.terraform_remote_state.platform.outputs.target_group_arn }
  alarm_actions       = [aws_sns_topic.alerts.arn]
  tags                = var.tags
}

resource "aws_cloudwatch_metric_alarm" "dashboard_unhealthy" {
  alarm_name          = "${var.project}-${var.env}-${local.region_short}-dashboard-tg-unhealthy"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 5
  metric_name         = "UnHealthyHostCount"
  namespace           = "AWS/ApplicationELB"
  period              = 60
  statistic           = "Maximum"
  threshold           = 0
  alarm_description   = "Dashboard target group has unhealthy targets for 5 minutes."
  treat_missing_data  = "notBreaching"
  dimensions          = { TargetGroup = data.terraform_remote_state.dashboard.outputs.dashboard_target_group_arn }
  alarm_actions       = [aws_sns_topic.alerts.arn]
  tags                = var.tags
}

resource "aws_cloudwatch_metric_alarm" "alb_5xx" {
  alarm_name          = "${var.project}-${var.env}-${local.region_short}-alb-5xx"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 5
  metric_name         = "HTTPCode_Target_5XX_Count"
  namespace           = "AWS/ApplicationELB"
  period              = 60
  statistic           = "Sum"
  threshold           = 10
  alarm_description   = "More than 10 5XX from targets in 5 minutes across the monitoring ALB (hub + dashboard)."
  treat_missing_data  = "notBreaching"
  dimensions = {
    # ALB metric dimension is "app/<name>/<hex>", extracted from the arn path suffix
    LoadBalancer = regex("^arn:aws:elasticloadbalancing:[^:]+:[0-9]+:loadbalancer/(.+)$", data.terraform_remote_state.platform.outputs.alb_arn)[0]
  }
  alarm_actions = [aws_sns_topic.alerts.arn]
  tags          = var.tags
}

# --- RDS (hub + usage) ---

resource "aws_cloudwatch_metric_alarm" "rds_cpu" {
  for_each            = local.rds_identifiers
  alarm_name          = "${var.project}-${var.env}-${local.region_short}-rds-${each.key}-cpu-high"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 3
  metric_name         = "CPUUtilization"
  namespace           = "AWS/RDS"
  period              = 60
  statistic           = "Average"
  threshold           = 80
  alarm_description   = "RDS ${each.key} CPU > 80% for 3 minutes."
  treat_missing_data  = "notBreaching"
  dimensions          = { DBInstanceIdentifier = each.value }
  alarm_actions       = [aws_sns_topic.alerts.arn]
  tags                = var.tags
}

resource "aws_cloudwatch_metric_alarm" "rds_connections" {
  for_each            = local.rds_identifiers
  alarm_name          = "${var.project}-${var.env}-${local.region_short}-rds-${each.key}-connections-high"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 5
  metric_name         = "DatabaseConnections"
  namespace           = "AWS/RDS"
  period              = 60
  statistic           = "Average"
  threshold           = 80
  alarm_description   = "RDS ${each.key} connections > 80 for 5 minutes."
  treat_missing_data  = "notBreaching"
  dimensions          = { DBInstanceIdentifier = each.value }
  alarm_actions       = [aws_sns_topic.alerts.arn]
  tags                = var.tags
}

resource "aws_cloudwatch_metric_alarm" "rds_memory" {
  for_each            = local.rds_identifiers
  alarm_name          = "${var.project}-${var.env}-${local.region_short}-rds-${each.key}-memory-low"
  comparison_operator = "LessThanThreshold"
  evaluation_periods  = 3
  metric_name         = "FreeableMemory"
  namespace           = "AWS/RDS"
  period              = 60
  statistic           = "Average"
  threshold           = 100 * 1024 * 1024 # 100 MiB
  alarm_description   = "RDS ${each.key} freeable memory < 100 MiB for 3 minutes."
  treat_missing_data  = "notBreaching"
  dimensions          = { DBInstanceIdentifier = each.value }
  alarm_actions       = [aws_sns_topic.alerts.arn]
  tags                = var.tags
}
