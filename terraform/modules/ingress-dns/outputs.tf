output "host" { value = local.host }
output "zone_id" { value = local.zone_id }
output "zone_nameservers" {
  description = "Point NS records at the registrar if a new zone was created."
  value       = local.use_existing ? [] : aws_route53_zone.hub[0].name_servers
}
output "certificate_arn" { value = aws_acm_certificate_validation.hub.certificate_arn }
