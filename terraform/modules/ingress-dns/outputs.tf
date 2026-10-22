output "alb_arn" { value = aws_lb.hub.arn }
output "alb_dns_name" { value = aws_lb.hub.dns_name }
output "alb_security_group_id" { value = aws_security_group.alb.id }
output "target_group_arn" { value = aws_lb_target_group.hub.arn }
output "target_group_name" { value = aws_lb_target_group.hub.name }
output "certificate_arn" { value = aws_acm_certificate.hub.arn }
output "certificate_status" { value = aws_acm_certificate.hub.status }
output "apex_certificate_arn" { value = aws_acm_certificate.apex.arn }
output "apex_certificate_status" { value = aws_acm_certificate.apex.status }
output "certificate_validation_records" {
  description = "ACM DNS validation records the operator must publish (hub + apex certificates merged). Key = record name, value = record value."
  value = merge(
    {
      for dvo in aws_acm_certificate.hub.domain_validation_options :
      trimsuffix(dvo.resource_record_name, ".") => dvo.resource_record_value
    },
    {
      for dvo in aws_acm_certificate.apex.domain_validation_options :
      trimsuffix(dvo.resource_record_name, ".") => dvo.resource_record_value
    },
  )
}
output "lb_controller_role_arn" { value = aws_iam_role.lb_controller.arn }

# Kept from the previous version of this module.
output "host" { value = local.host }
output "apex_host" { value = var.domain }
output "zone_id" { value = local.zone_id }
output "zone_nameservers" {
  description = "Point NS records at the registrar if a new zone was created (empty in manual DNS mode)."
  value       = local.use_existing_zone ? [] : try(aws_route53_zone.hub[0].name_servers, [])
}
