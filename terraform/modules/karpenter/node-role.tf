# IAM role + instance profile for nodes launched by Karpenter.
# The role name MUST match the `role:` in the EC2NodeClass manifests (<cluster>-karpenter-node).
# The controller needs iam:PassRole on this role (currently covered by temporary EC2FullAccess — TODO narrow it).

data "aws_partition" "node" {}

resource "aws_iam_role" "node" {
  name = "${var.cluster_name}-karpenter-node"
  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Service = "ec2.amazonaws.com" }
      Action    = "sts:AssumeRole"
    }]
  })
  tags = var.tags
}

locals {
  node_policy_arns = [
    "arn:${data.aws_partition.node.partition}:iam::aws:policy/AmazonEKSWorkerNodePolicy",
    "arn:${data.aws_partition.node.partition}:iam::aws:policy/AmazonEKS_CNI_Policy",
    "arn:${data.aws_partition.node.partition}:iam::aws:policy/AmazonSSMManagedInstanceCore",
  ]
}

resource "aws_iam_role_policy_attachment" "node" {
  count      = length(local.node_policy_arns)
  role       = aws_iam_role.node.name
  policy_arn = local.node_policy_arns[count.index]
}

resource "aws_iam_instance_profile" "node" {
  name = "${var.cluster_name}-karpenter-node"
  role = aws_iam_role.node.name
  tags = var.tags
}

# The EKS add-ons (VPC CNI, EBS CSI, EFS CSI, kube-proxy, pod identity agent) live in
# the AWS owned ECR registry 602401143452. A node can only pull them when its role is
# allowed to authenticate against ECR. Without this policy every pull fails with
# "authorization failed: no basic auth credentials" and the node never turns Ready.
# The managed node group gets the same permission from AmazonEKSClusterPolicy.
resource "aws_iam_role_policy" "node_ecr" {
  name = "${var.cluster_name}-karpenter-node-ecr"
  role = aws_iam_role.node.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect = "Allow"
      Action = [
        "ecr:GetAuthorizationToken",
        "ecr:BatchGetImage",
        "ecr:BatchCheckLayerAvailability",
        "ecr:GetDownloadUrlForLayer",
      ]
      Resource = "*"
    }]
  })
}
