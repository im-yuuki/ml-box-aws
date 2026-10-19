locals {
  # /24 per AZ for private + public on a /16. Enough for prefix delegation (thousands of pods).
  # Prod with 2000 users: consider adding a secondary CIDR 100.64.0.0/16.
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

  # NAT GW only with managed_per_az. "none"/"fck_nat" = false (saves 100% of NAT GW cost).
  enable_nat_gateway     = local.use_managed_nat
  single_nat_gateway     = false
  one_nat_gateway_per_az = true

  # IPv6 dual-stack: the module requests the /56 Amazon-provided block itself, creates the
  # egress-only IGW + ::/0 route for private subnets (free). Subnets need ipv6_prefixes to get IPv6.
  enable_ipv6                                    = true
  public_subnet_ipv6_prefixes                    = [for i in range(local.az_count) : i]
  private_subnet_ipv6_prefixes                   = [for i in range(local.az_count) : i + 10]
  private_subnet_assign_ipv6_address_on_creation = true
  public_subnet_assign_ipv6_address_on_creation  = true

  enable_dns_hostnames = true
  enable_dns_support   = true

  # Tags for ELB/ALB discovery + Karpenter discovery
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

# VPC endpoints via submodule (the v5 root module no longer has enable_*_endpoint booleans).
# S3 gateway (free) always on; interface endpoints (ECR/STS/Logs ~$10/month/AZ each) prod-only.
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

# fck-nat: created only when nat_mode="fck_nat". Cheap NAT instance for legacy IPv4
# (PyPI, GitHub, registries without IPv6 yet). Placed in the first AZ's public subnet, updates
# the 0.0.0.0/0 route of every private route table itself.
# Doc: https://fck-nat.dev/stable/deploying (AMI owner 568608671756, fck-nat-al2023-*).
module "fck_nat" {
  count   = local.use_fck_nat ? 1 : 0
  source  = "RaJiska/fck-nat/aws"
  version = "1.3.0" # literal mandatory (init won't accept a variable); 1.3.0 = last release supporting AWS provider 5.x

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
