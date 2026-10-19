variable "region" {
  description = "AWS region. 1 cluster per region. Apply only 1 region at a time."
  type        = string
  default     = "ap-southeast-2"
  validation {
    condition     = contains(["ap-southeast-1", "ap-southeast-2", "ap-southeast-3"], var.region)
    error_message = "region must be one of the 3 SEA regions: ap-southeast-1/2/3 (see docs/regions.md)."
  }
}

# CIDR table for the 3 SEA regions — kept non-overlapping for future cross-region peering/replication.
# ap-southeast-2 holds 10.0.0.0/16 (being deployed first).
variable "region_cidrs" {
  description = "VPC CIDR per region. Override via vpc_cidr when needed."
  type        = map(string)
  default = {
    ap-southeast-1 = "10.1.0.0/16" # Singapore
    ap-southeast-2 = "10.0.0.0/16" # Sydney (first)
    ap-southeast-3 = "10.2.0.0/16" # Jakarta
  }
}

variable "region_azs" {
  description = "AZs per region. Override via azs when needed."
  type        = map(list(string))
  default = {
    ap-southeast-1 = ["ap-southeast-1a", "ap-southeast-1b", "ap-southeast-1c"]
    ap-southeast-2 = ["ap-southeast-2a", "ap-southeast-2b", "ap-southeast-2c"]
    ap-southeast-3 = ["ap-southeast-3a", "ap-southeast-3b", "ap-southeast-3c"]
  }
}

# Short region codes for naming (IAM name_prefix is limited to 38 characters).
variable "region_short" {
  type = map(string)
  default = {
    ap-southeast-1 = "apse1"
    ap-southeast-2 = "apse2"
    ap-southeast-3 = "apse3"
  }
}

variable "env" {
  description = "Environment name (dev/prod), used for naming + backend key."
  type        = string
  default     = "dev"
}

variable "cluster_name" {
  description = "EKS cluster name."
  type        = string
  default     = "jhub-gpu-sandbox"
}

variable "cluster_version" {
  description = "K8s version. Default 1.36 (standard support through 08/2027). 1.33 has fallen into extended support (extra fees)."
  type        = string
  default     = "1.36"
}

variable "vpc_cidr" {
  description = "Override the VPC CIDR. Empty = use region_cidrs[region]."
  type        = string
  default     = ""
}

variable "azs" {
  description = "Override AZs. Empty = use region_azs[region]."
  type        = list(string)
  default     = []
}

variable "nat_mode" {
  description = "managed_per_az (1 NAT/AZ, HA) | fck_nat (cheap NAT instance) | none (IPv6-only, 0 NAT cost)."
  type        = string
  default     = "managed_per_az"
  validation {
    condition     = contains(["managed_per_az", "fck_nat", "none"], var.nat_mode)
    error_message = "nat_mode must be managed_per_az, fck_nat or none."
  }
}

variable "enable_vpc_interface_endpoints" {
  description = "Enable ECR/STS/Logs endpoints. Dev=false, prod=true."
  type        = bool
  default     = false
}

variable "fck_nat_instance_type" {
  description = "Instance for fck-nat when nat_mode=fck_nat. t4g.nano is enough for ~5Gbps burst in dev."
  type        = string
  default     = "t4g.nano"
}

variable "vpc_module_version" {
  description = "Pin the terraform-aws-modules/vpc/aws version. Check the current release."
  type        = string
  default     = "~> 5.8"
}

variable "eks_module_version" {
  description = "Pin the terraform-aws-modules/eks/aws version. Check the current release."
  type        = string
  default     = "~> 20.8"
}

variable "karpenter_chart_version" {
  description = "Karpenter chart (oci://public.ecr.aws/karpenter/karpenter). Default = latest verified release."
  type        = string
  default     = "1.15.0" # verified 2026-10-12: chart v1 has NO "v" prefix (different from the v0.x line)
}

variable "karpenter_version" {
  description = "Karpenter app version matching the chart."
  type        = string
  default     = "v1.15.0" # verified 2026-10-12; chart/app in lockstep
}

variable "system_instance_types" {
  description = "MNG system pool (small CPU, stable, no GPU)."
  type        = list(string)
  default     = ["m6i.large"]
}

variable "kms_key_arn_ebs" {
  description = "KMS key ARN for the EBS EC2NodeClass. Empty = alias/aws/ebs."
  type        = string
  default     = ""
}

variable "tags" {
  description = "Standard tags (governance): plan/user/org/tier + Env/Project."
  type        = map(string)
  default = {
    Project     = "jhub-gpu-sandbox"
    Environment = "dev"
    ManagedBy   = "terraform"
  }
}

# VRAM commit/ceiling — latest decision: commit 8GiB, ceiling 12GiB for the shared L4 pool.
# Time-slicing replicas derived: L4 22.5GiB usable ~ 24GB -> floor(24/8)=3 @ factor 1.0.
variable "vram_commit_mib" {
  type    = number
  default = 8192
}

variable "vram_ceiling_mib" {
  type    = number
  default = 12288
}

variable "gpu_shared_replicas_l4" {
  description = "Time-slicing replicas for L4 @ commit 8GB, factor 1.0."
  type        = number
  default     = 3
}
