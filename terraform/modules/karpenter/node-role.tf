# IAM role + instance profile cho node do Karpenter launch.
# Tên role PHẢI khớp `role:` trong EC2NodeClass manifests (<cluster>-karpenter-node).
# Controller cần iam:PassRole role này (hiện phủ bởi EC2FullAccess tạm — TODO thu hẹp).

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
    "arn:${data.aws_partition.node.partition}:iam::aws:policy/AmazonEC2ContainerRegistryReadOnly",
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
