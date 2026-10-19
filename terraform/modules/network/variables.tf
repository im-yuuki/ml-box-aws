# Network: dual-stack, flexible NAT via nat_mode.
# - "managed_per_az": 1 NAT GW/AZ (default, HA — ~$43/month/NAT in Sydney + $0.059/GB).
# - "fck_nat": t4g.nano NAT instance ~$5/month (legacy IPv4 for PyPI/GitHub/registries without IPv6).
# - "none": IPv6-only, ZERO NAT cost. IPv4 only via VPC endpoints (S3/ECR/STS).
#   IPv6 outbound via Egress-only IGW (free). Pod IPv4 has no internet access in this mode.
# - Public subnets: ALB hub (+ NAT when enabled). Private subnets: nodes/pods.

variable "name" { type = string }
variable "vpc_cidr" { type = string }
variable "azs" { type = list(string) }
variable "cluster_name" { type = string }
variable "tags" { type = map(string) }

variable "nat_mode" {
  description = "managed_per_az | fck_nat | none"
  type        = string
  default     = "managed_per_az"
  validation {
    condition     = contains(["managed_per_az", "fck_nat", "none"], var.nat_mode)
    error_message = "nat_mode must be managed_per_az, fck_nat or none."
  }
}

variable "enable_vpc_interface_endpoints" {
  description = "Enable ECR/STS/Logs/Monitoring endpoints. Dev=false (saves money), prod=true."
  type        = bool
  default     = false
}

variable "fck_nat_instance_type" {
  description = "Instance for fck-nat. t4g.nano is enough for ~5Gbps burst on dev."
  type        = string
  default     = "t4g.nano"
}
