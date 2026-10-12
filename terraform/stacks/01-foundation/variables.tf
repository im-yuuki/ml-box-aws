variable "region" {
  description = "AWS region. 1 cluster mỗi region. Chỉ apply 1 region mỗi lần."
  type        = string
  default     = "ap-southeast-2"
  validation {
    condition     = contains(["ap-southeast-1", "ap-southeast-2", "ap-southeast-3"], var.region)
    error_message = "region phải là 1 trong 3 SEA: ap-southeast-1/2/3 (xem docs/regions.md)."
  }
}

# Bảng CIDR 3 region SEA — không trùng nhau để sau này peering/replication chéo region.
# ap-southeast-2 giữ 10.0.0.0/16 (đang triển khai đầu tiên).
variable "region_cidrs" {
  description = "VPC CIDR theo region. Override bằng vpc_cidr khi cần."
  type        = map(string)
  default = {
    ap-southeast-1 = "10.1.0.0/16" # Singapore
    ap-southeast-2 = "10.0.0.0/16" # Sydney (đầu tiên)
    ap-southeast-3 = "10.2.0.0/16" # Jakarta
  }
}

variable "region_azs" {
  description = "AZ theo region. Override bằng azs khi cần."
  type        = map(list(string))
  default = {
    ap-southeast-1 = ["ap-southeast-1a", "ap-southeast-1b", "ap-southeast-1c"]
    ap-southeast-2 = ["ap-southeast-2a", "ap-southeast-2b", "ap-southeast-2c"]
    ap-southeast-3 = ["ap-southeast-3a", "ap-southeast-3b", "ap-southeast-3c"]
  }
}

# Mã region ngắn cho naming (IAM name_prefix giới hạn 38 ký tự).
variable "region_short" {
  type = map(string)
  default = {
    ap-southeast-1 = "apse1"
    ap-southeast-2 = "apse2"
    ap-southeast-3 = "apse3"
  }
}

variable "env" {
  description = "Tên môi trường (dev/prod), dùng cho naming + backend key."
  type        = string
  default     = "dev"
}

variable "cluster_name" {
  description = "Tên EKS cluster."
  type        = string
  default     = "jhub-gpu-sandbox"
}

variable "cluster_version" {
  description = "Phiên bản K8s. Mặc định 1.36 (standard support tới 08/2027). 1.33 đã rơi vào extended (tốn thêm phí)."
  type        = string
  default     = "1.36"
}

variable "vpc_cidr" {
  description = "Override CIDR VPC. Để trống = dùng region_cidrs[region]."
  type        = string
  default     = ""
}

variable "azs" {
  description = "Override AZ. Để trống = dùng region_azs[region]."
  type        = list(string)
  default     = []
}

variable "nat_mode" {
  description = "managed_per_az (1 NAT/AZ, HA) | fck_nat (NAT instance rẻ) | none (IPv6-only, 0 phí NAT)."
  type        = string
  default     = "managed_per_az"
  validation {
    condition     = contains(["managed_per_az", "fck_nat", "none"], var.nat_mode)
    error_message = "nat_mode phải là managed_per_az, fck_nat hoặc none."
  }
}

variable "enable_vpc_interface_endpoints" {
  description = "Bật ECR/STS/Logs endpoints. Dev=false, prod=true."
  type        = bool
  default     = false
}

variable "fck_nat_instance_type" {
  description = "Instance cho fck-nat khi nat_mode=fck_nat. t4g.nano đủ ~5Gbps burst cho dev."
  type        = string
  default     = "t4g.nano"
}

variable "vpc_module_version" {
  description = "Pin version terraform-aws-modules/vpc/aws. Kiểm tra release hiện hành."
  type        = string
  default     = "~> 5.8"
}

variable "eks_module_version" {
  description = "Pin version terraform-aws-modules/eks/aws. Kiểm tra release hiện hành."
  type        = string
  default     = "~> 20.8"
}

variable "karpenter_chart_version" {
  description = "Chart karpenter (oci://public.ecr.aws/karpenter/karpenter). Mặc định = release mới nhất đã verify."
  type        = string
  default     = "1.15.0" # verify 2026-10-12: chart v1 KHÔNG có prefix "v" (khác dòng v0.x)
}

variable "karpenter_version" {
  description = "App version Karpenter tương ứng chart."
  type        = string
  default     = "v1.15.0" # verify 2026-10-12; chart/app lockstep
}

variable "system_instance_types" {
  description = "MNG system pool (CPU nhỏ, ổn định, không GPU)."
  type        = list(string)
  default     = ["m6i.large"]
}

variable "kms_key_arn_ebs" {
  description = "KMS key ARN cho EBS EC2NodeClass. Để trống = alias/aws/ebs."
  type        = string
  default     = ""
}

variable "tags" {
  description = "Tag chuẩn (governance): plan/user/org/tier + Env/Project."
  type        = map(string)
  default = {
    Project     = "jhub-gpu-sandbox"
    Environment = "dev"
    ManagedBy   = "terraform"
  }
}

# VRAM commit/ceiling — chốt mới: commit 8GiB, ceiling 12GiB cho pool shared L4.
# Replicas time-slicing suy ra: L4 22.5GiB usable ~ 24GB -> floor(24/8)=3 @ factor 1.0.
variable "vram_commit_mib" {
  type    = number
  default = 8192
}

variable "vram_ceiling_mib" {
  type    = number
  default = 12288
}

variable "gpu_shared_replicas_l4" {
  description = "replicas time-slicing cho L4 @ commit 8GB, factor 1.0."
  type        = number
  default     = 3
}
