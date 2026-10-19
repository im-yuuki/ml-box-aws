output "vpc_id" { value = module.vpc.vpc_id }
output "private_subnet_ids" { value = module.vpc.private_subnets }
output "public_subnet_ids" { value = module.vpc.public_subnets }
output "vpc_ipv6_cidr" { value = module.vpc.vpc_ipv6_cidr_block }
output "private_route_table_ids" { value = module.vpc.private_route_table_ids }
output "nat_mode" { value = var.nat_mode }
output "nat_ids" {
  description = "NAT GW IDs when managed_*; empty when none/fck_nat."
  value       = try(module.vpc.natgw_ids, [])
}
