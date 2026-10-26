output "alb_arn" { value = aws_lb.hub.arn }
output "alb_dns_name" { value = aws_lb.hub.dns_name }
output "alb_security_group_id" { value = aws_security_group.alb.id }
output "target_group_arn" { value = aws_lb_target_group.hub.arn }
output "target_group_name" { value = aws_lb_target_group.hub.name }
output "certificate_arn" {
  value = var.certificate_arn
}

output "certificate_status" {
  value = var.certificate_status
}

output "apex_certificate_arn" {
  value = var.apex_certificate_arn
}

output "apex_certificate_status" {
  value = var.apex_certificate_status
}

output "certificate_validation_records" {
  description = "ACM validation records are owned by 00-bootstrap."
  value       = {}
}

output "lb_controller_role_arn" { value = aws_iam_role.lb_controller.arn }
output "host" { value = local.host }
output "apex_host" { value = var.domain }
output "zone_id" { value = local.zone_id }
output "zone_nameservers" {
  description = "Nameservers of the persistent delegated zone owned by 00-bootstrap."
  value       = var.route53_zone_nameservers
}
