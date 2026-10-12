# Network: dual-stack, NAT linh hoạt theo nat_mode.
# - "managed_per_az": 1 NAT GW/AZ (mặc định, HA — ~$43/tháng/NAT ở Sydney + $0.059/GB).
# - "fck_nat": NAT instance t4g.nano ~$5/tháng (IPv4 legacy PyPI/GitHub/registry chưa IPv6).
# - "none": IPv6-only, ZERO chi phí NAT. IPv4 chỉ qua VPC endpoints (S3/ECR/STS).
#   IPv6 outbound qua Egress-only IGW (free). Pod IPv4 không ra internet được ở mode này.
# - Public subnets: ALB hub (+ NAT khi có). Private subnets: nodes/pods.

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
    error_message = "nat_mode phải là managed_per_az, fck_nat hoặc none."
  }
}

variable "enable_vpc_interface_endpoints" {
  description = "Bật ECR/STS/Logs/Monitoring endpoints. Dev=false (tiết kiệm), prod=true."
  type        = bool
  default     = false
}

variable "fck_nat_instance_type" {
  description = "Instance cho fck-nat. t4g.nano đủ ~5Gbps burst cho dev."
  type        = string
  default     = "t4g.nano"
}
