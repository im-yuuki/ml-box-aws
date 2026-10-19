# Least-privilege policy for the controller, translated from the standard CloudFormation of
# aws/karpenter-provider-aws (tag v1.15.0). Replaces the temporary EC2FullAccess placeholder.

locals {
  controller_partition = data.aws_partition.current.partition
  controller_region    = data.aws_region.current.name
  controller_account   = data.aws_caller_identity.current.account_id
  cluster_arn          = "arn:${local.controller_partition}:eks:${local.controller_region}:${local.controller_account}:cluster/${var.cluster_name}"
}

resource "aws_iam_policy" "controller_lifecycle" {
  name = "${var.cluster_name}-KarpenterControllerNodeLifecycle"
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid    = "AllowScopedEC2InstanceAccessActions"
        Effect = "Allow"
        Resource = [
          "arn:${local.controller_partition}:ec2:${local.controller_region}::image/*",
          "arn:${local.controller_partition}:ec2:${local.controller_region}::snapshot/*",
          "arn:${local.controller_partition}:ec2:${local.controller_region}:*:security-group/*",
          "arn:${local.controller_partition}:ec2:${local.controller_region}:*:subnet/*",
          "arn:${local.controller_partition}:ec2:${local.controller_region}:*:capacity-reservation/*",
          "arn:${local.controller_partition}:ec2:${local.controller_region}:*:placement-group/*",
        ]
        Action = ["ec2:RunInstances", "ec2:CreateFleet"]
      },
      {
        Sid      = "AllowScopedEC2LaunchTemplateAccessActions"
        Effect   = "Allow"
        Resource = "arn:${local.controller_partition}:ec2:${local.controller_region}:*:launch-template/*"
        Action   = ["ec2:RunInstances", "ec2:CreateFleet"]
        Condition = {
          StringEquals = { "aws:ResourceTag/kubernetes.io/cluster/${var.cluster_name}" = "owned" }
          StringLike   = { "aws:ResourceTag/karpenter.sh/nodepool" = "*" }
        }
      },
      {
        Sid    = "AllowScopedEC2InstanceActionsWithTags"
        Effect = "Allow"
        Resource = [
          "arn:${local.controller_partition}:ec2:${local.controller_region}:*:fleet/*",
          "arn:${local.controller_partition}:ec2:${local.controller_region}:*:instance/*",
          "arn:${local.controller_partition}:ec2:${local.controller_region}:*:volume/*",
          "arn:${local.controller_partition}:ec2:${local.controller_region}:*:network-interface/*",
          "arn:${local.controller_partition}:ec2:${local.controller_region}:*:launch-template/*",
          "arn:${local.controller_partition}:ec2:${local.controller_region}:*:spot-instances-request/*",
        ]
        Action = ["ec2:RunInstances", "ec2:CreateFleet", "ec2:CreateLaunchTemplate"]
        Condition = {
          StringEquals = {
            "aws:RequestTag/kubernetes.io/cluster/${var.cluster_name}" = "owned"
            "aws:RequestTag/eks:eks-cluster-name"                      = var.cluster_name
          }
          StringLike = { "aws:RequestTag/karpenter.sh/nodepool" = "*" }
        }
      },
      {
        Sid    = "AllowScopedResourceCreationTagging"
        Effect = "Allow"
        Resource = [
          "arn:${local.controller_partition}:ec2:${local.controller_region}:*:fleet/*",
          "arn:${local.controller_partition}:ec2:${local.controller_region}:*:instance/*",
          "arn:${local.controller_partition}:ec2:${local.controller_region}:*:volume/*",
          "arn:${local.controller_partition}:ec2:${local.controller_region}:*:network-interface/*",
          "arn:${local.controller_partition}:ec2:${local.controller_region}:*:launch-template/*",
          "arn:${local.controller_partition}:ec2:${local.controller_region}:*:spot-instances-request/*",
        ]
        Action = "ec2:CreateTags"
        Condition = {
          StringEquals = {
            "aws:RequestTag/kubernetes.io/cluster/${var.cluster_name}" = "owned"
            "aws:RequestTag/eks:eks-cluster-name"                      = var.cluster_name
            "ec2:CreateAction"                                         = ["RunInstances", "CreateFleet", "CreateLaunchTemplate"]
          }
          StringLike = { "aws:RequestTag/karpenter.sh/nodepool" = "*" }
        }
      },
      {
        Sid      = "AllowScopedResourceTagging"
        Effect   = "Allow"
        Resource = "arn:${local.controller_partition}:ec2:${local.controller_region}:*:instance/*"
        Action   = "ec2:CreateTags"
        Condition = {
          StringEquals = { "aws:ResourceTag/kubernetes.io/cluster/${var.cluster_name}" = "owned" }
          StringLike   = { "aws:ResourceTag/karpenter.sh/nodepool" = "*" }
          StringEqualsIfExists = {
            "aws:RequestTag/eks:eks-cluster-name" = var.cluster_name
          }
          "ForAllValues:StringEquals" = {
            "aws:TagKeys" = ["eks:eks-cluster-name", "karpenter.sh/nodeclaim", "Name"]
          }
        }
      },
      {
        Sid    = "AllowScopedDeletion"
        Effect = "Allow"
        Resource = [
          "arn:${local.controller_partition}:ec2:${local.controller_region}:*:instance/*",
          "arn:${local.controller_partition}:ec2:${local.controller_region}:*:launch-template/*",
        ]
        Action = ["ec2:TerminateInstances", "ec2:DeleteLaunchTemplate"]
        Condition = {
          StringEquals = { "aws:ResourceTag/kubernetes.io/cluster/${var.cluster_name}" = "owned" }
          StringLike   = { "aws:ResourceTag/karpenter.sh/nodepool" = "*" }
        }
      },
    ]
  })
  tags = var.tags
}

resource "aws_iam_policy" "controller_iam" {
  name = "${var.cluster_name}-KarpenterControllerIAMIntegration"
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid      = "AllowPassingInstanceRole"
        Effect   = "Allow"
        Resource = aws_iam_role.node.arn
        Action   = "iam:PassRole"
        Condition = {
          StringEquals = { "iam:PassedToService" = ["ec2.amazonaws.com", "ec2.amazonaws.com.cn"] }
        }
      },
      {
        Sid      = "AllowScopedInstanceProfileCreationActions"
        Effect   = "Allow"
        Resource = "arn:${local.controller_partition}:iam::${local.controller_account}:instance-profile/*"
        Action   = "iam:CreateInstanceProfile"
        Condition = {
          StringEquals = {
            "aws:RequestTag/kubernetes.io/cluster/${var.cluster_name}" = "owned"
            "aws:RequestTag/eks:eks-cluster-name"                      = var.cluster_name
            "aws:RequestTag/topology.kubernetes.io/region"             = local.controller_region
          }
          StringLike = { "aws:RequestTag/karpenter.k8s.aws/ec2nodeclass" = "*" }
        }
      },
      {
        Sid      = "AllowScopedInstanceProfileTagActions"
        Effect   = "Allow"
        Resource = "arn:${local.controller_partition}:iam::${local.controller_account}:instance-profile/*"
        Action   = "iam:TagInstanceProfile"
        Condition = {
          StringEquals = {
            "aws:ResourceTag/kubernetes.io/cluster/${var.cluster_name}" = "owned"
            "aws:ResourceTag/topology.kubernetes.io/region"             = local.controller_region
            "aws:RequestTag/kubernetes.io/cluster/${var.cluster_name}"  = "owned"
            "aws:RequestTag/eks:eks-cluster-name"                       = var.cluster_name
            "aws:RequestTag/topology.kubernetes.io/region"              = local.controller_region
          }
          StringLike = {
            "aws:ResourceTag/karpenter.k8s.aws/ec2nodeclass" = "*"
            "aws:RequestTag/karpenter.k8s.aws/ec2nodeclass"  = "*"
          }
        }
      },
      {
        Sid      = "AllowScopedInstanceProfileActions"
        Effect   = "Allow"
        Resource = "arn:${local.controller_partition}:iam::${local.controller_account}:instance-profile/*"
        Action   = ["iam:AddRoleToInstanceProfile", "iam:RemoveRoleFromInstanceProfile", "iam:DeleteInstanceProfile"]
        Condition = {
          StringEquals = {
            "aws:ResourceTag/kubernetes.io/cluster/${var.cluster_name}" = "owned"
            "aws:ResourceTag/topology.kubernetes.io/region"             = local.controller_region
          }
          StringLike = { "aws:ResourceTag/karpenter.k8s.aws/ec2nodeclass" = "*" }
        }
      },
    ]
  })
  tags = var.tags
}

resource "aws_iam_policy" "controller_eks" {
  name = "${var.cluster_name}-KarpenterControllerEKSIntegration"
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Sid      = "AllowAPIServerEndpointDiscovery"
      Effect   = "Allow"
      Resource = local.cluster_arn
      Action   = "eks:DescribeCluster"
    }]
  })
  tags = var.tags
}

resource "aws_iam_policy" "controller_interruption" {
  name = "${var.cluster_name}-KarpenterControllerInterruption"
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Sid      = "AllowInterruptionQueueActions"
      Effect   = "Allow"
      Resource = aws_sqs_queue.interruption.arn
      Action   = ["sqs:DeleteMessage", "sqs:GetQueueUrl", "sqs:ReceiveMessage"]
    }]
  })
  tags = var.tags
}

resource "aws_iam_policy" "controller_discovery" {
  name = "${var.cluster_name}-KarpenterControllerResourceDiscovery"
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid      = "AllowRegionalReadActions"
        Effect   = "Allow"
        Resource = "*"
        Action = [
          "ec2:DescribeCapacityReservations", "ec2:DescribeImages", "ec2:DescribeInstances",
          "ec2:DescribeInstanceStatus", "ec2:DescribeInstanceTypeOfferings", "ec2:DescribeInstanceTypes",
          "ec2:DescribeLaunchTemplates", "ec2:DescribePlacementGroups", "ec2:DescribeSecurityGroups",
          "ec2:DescribeSpotPriceHistory", "ec2:DescribeSubnets",
        ]
        Condition = { StringEquals = { "aws:RequestedRegion" = local.controller_region } }
      },
      {
        Sid      = "AllowSSMReadActions"
        Effect   = "Allow"
        Resource = "arn:${local.controller_partition}:ssm:${local.controller_region}::parameter/aws/service/*"
        Action   = "ssm:GetParameter"
      },
      {
        Sid      = "AllowPricingReadActions"
        Effect   = "Allow"
        Resource = "*"
        Action   = "pricing:GetProducts"
      },
      {
        Sid      = "AllowUnscopedInstanceProfileListAction"
        Effect   = "Allow"
        Resource = "*"
        Action   = "iam:ListInstanceProfiles"
      },
      {
        Sid      = "AllowInstanceProfileReadActions"
        Effect   = "Allow"
        Resource = "arn:${local.controller_partition}:iam::${local.controller_account}:instance-profile/*"
        Action   = "iam:GetInstanceProfile"
      },
    ]
  })
  tags = var.tags
}

resource "aws_iam_role_policy_attachment" "controller" {
  count = length([
    aws_iam_policy.controller_lifecycle.arn,
    aws_iam_policy.controller_iam.arn,
    aws_iam_policy.controller_eks.arn,
    aws_iam_policy.controller_interruption.arn,
    aws_iam_policy.controller_discovery.arn,
  ])
  role = aws_iam_role.karpenter.name
  policy_arn = [
    aws_iam_policy.controller_lifecycle.arn,
    aws_iam_policy.controller_iam.arn,
    aws_iam_policy.controller_eks.arn,
    aws_iam_policy.controller_interruption.arn,
    aws_iam_policy.controller_discovery.arn,
  ][count.index]
}
