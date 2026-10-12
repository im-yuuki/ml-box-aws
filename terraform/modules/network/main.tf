locals {
  # /24 mỗi AZ cho private + public trên /16. Đủ cho prefix delegation (hàng nghìn pod).
  # Prod 2000 user: cân nhắc thêm secondary CIDR 100.64.0.0/16.
  az_count = length(var.azs)

  use_managed_nat = var.nat_mode == "managed_per_az"
  use_fck_nat     = var.nat_mode == "fck_nat"
}

module "vpc" {
  source  = "terraform-aws-modules/vpc/aws"
  version = "~> 5.8"

  name = var.name
  cidr = var.vpc_cidr
  azs  = var.azs

  private_subnets = [for i in range(local.az_count) : cidrsubnet(var.vpc_cidr, 8, i)]
  public_subnets  = [for i in range(local.az_count) : cidrsubnet(var.vpc_cidr, 8, i + 100)]

  # NAT GW chỉ khi managed_per_az. "none"/"fck_nat" = false (tiết kiệm 100% phí NAT GW).
  enable_nat_gateway     = local.use_managed_nat
  single_nat_gateway     = false
  one_nat_gateway_per_az = true

  # IPv6 dual-stack: module tự xin /56 Amazon-provided, tự tạo egress-only IGW
  # + route ::/0 cho private subnets (free). Subnet cần ipv6_prefixes mới có IPv6.
  enable_ipv6                                    = true
  public_subnet_ipv6_prefixes                    = [for i in range(local.az_count) : i]
  private_subnet_ipv6_prefixes                   = [for i in range(local.az_count) : i + 10]
  private_subnet_assign_ipv6_address_on_creation = true
  public_subnet_assign_ipv6_address_on_creation  = true

  enable_dns_hostnames = true
  enable_dns_support   = true

  # Tag cho ELB/ALB discovery + Karpenter discovery
  public_subnet_tags = {
    "kubernetes.io/role/elb"                    = "1"
    "kubernetes.io/cluster/${var.cluster_name}" = "shared"
  }
  private_subnet_tags = {
    "kubernetes.io/role/internal-elb"           = "1"
    "kubernetes.io/cluster/${var.cluster_name}" = "shared"
    "karpenter.sh/discovery"                    = var.cluster_name
  }
  vpc_tags = {
    "karpenter.sh/discovery" = var.cluster_name
  }

  tags = var.tags
}

# VPC endpoints qua submodule (root module v5 không còn boolean enable_*_endpoint).
# S3 gateway (free) luôn bật; interface (ECR/STS/Logs ~$10/tháng/AZ mỗi cái) chỉ ở prod.
module "vpc_endpoints" {
  source  = "terraform-aws-modules/vpc/aws//modules/vpc-endpoints"
  version = "~> 5.8"

  vpc_id = module.vpc.vpc_id

  create_security_group      = true
  security_group_name_prefix = "${var.name}-vpc-endpoints-"
  security_group_description = "VPC endpoint security group"
  security_group_rules = {
    ingress_https = {
      description = "HTTPS from VPC"
      cidr_blocks = [module.vpc.vpc_cidr_block]
    }
  }

  endpoints = merge(
    {
      s3 = {
        service         = "s3"
        service_type    = "Gateway"
        route_table_ids = module.vpc.private_route_table_ids
        tags            = { Name = "${var.name}-s3" }
      }
    },
    var.enable_vpc_interface_endpoints ? {
      ecr_api = {
        service             = "ecr.api"
        private_dns_enabled = true
        subnet_ids          = module.vpc.private_subnets
        tags                = { Name = "${var.name}-ecr-api" }
      },
      ecr_dkr = {
        service             = "ecr.dkr"
        private_dns_enabled = true
        subnet_ids          = module.vpc.private_subnets
        tags                = { Name = "${var.name}-ecr-dkr" }
      },
      sts = {
        service             = "sts"
        private_dns_enabled = true
        subnet_ids          = module.vpc.private_subnets
        tags                = { Name = "${var.name}-sts" }
      },
      logs = {
        service             = "logs"
        private_dns_enabled = true
        subnet_ids          = module.vpc.private_subnets
        tags                = { Name = "${var.name}-logs" }
      }
    } : {}
  )

  tags = var.tags
}

# fck-nat: chỉ tạo khi nat_mode="fck_nat". NAT instance giá rẻ cho IPv4 legacy
# (PyPI, GitHub, registry chưa IPv6). Đặt ở public subnet AZ đầu, tự cập nhật
# route 0.0.0.0/0 của mọi private route table.
# Doc: https://fck-nat.dev/stable/deploying (AMI owner 568608671756, fck-nat-al2023-*).
module "fck_nat" {
  count   = local.use_fck_nat ? 1 : 0
  source  = "RaJiska/fck-nat/aws"
  version = "1.3.0" # literal bắt buộc (init không nhận biến); 1.3.0 = bản cuối hỗ trợ AWS provider 5.x

  name      = "${var.name}-fck-nat"
  vpc_id    = module.vpc.vpc_id
  subnet_id = module.vpc.public_subnets[0]

  instance_type       = var.fck_nat_instance_type
  update_route_tables = true
  route_tables_ids = {
    for i, rtb in module.vpc.private_route_table_ids : "private-${i}" => rtb
  }
  tags = var.tags
}
