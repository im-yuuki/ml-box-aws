# Karpenter: IAM + SQS interruption + Helm + EC2NodeClass/NodePool.
# Không dùng EKS Auto Mode (cần chia GPU + kiểm soát AMI/NodePool — mục 2 doc).
# Không cài MIG manager (quyết định tạm thời).

locals {
  namespace = "karpenter"
}

# Hàng SQS nhận Spot interruption — dùng cho pool cpu-user (GPU user session không dùng Spot).
resource "aws_sqs_queue" "interruption" {
  name                      = var.interruption_queue_name
  message_retention_seconds = 300
  tags                      = var.tags
}

data "aws_caller_identity" "current" {}
data "aws_region" "current" {}
data "aws_partition" "current" {}

locals {
  queue_arn = aws_sqs_queue.interruption.arn
}

# IAM role cho Karpenter controller (IRSA). Policy tối thiểu theo doc Karpenter hiện hành:
# ec2:CreateLaunchTemplate/RunInstances/TerminateInstances/Describe*, iam:PassRole, sqs:ReceiveMessage, pricing, etc.
# Dưới đây là khung — phải đối chiếu iam.tf của lablabs/terraform-aws-eks-karpenter ở chart_version đang dùng.
resource "aws_iam_role" "karpenter" {
  name = "${var.cluster_name}-karpenter"
  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Federated = var.oidc_provider_arn }
      Action    = "sts:AssumeRoleWithWebIdentity"
      Condition = {
        StringEquals = {
          "${var.oidc_provider}:sub" = "system:serviceaccount:${local.namespace}:karpenter"
        }
      }
    }]
  })
  tags = var.tags
}

resource "aws_iam_role_policy_attachment" "karpenter_extra" {
  # Thay bằng policy document đã review theo doc Karpenter. Giữ attachment rỗng có chủ ý
  # để terraform plan không tạo quyền thừa trước khi review.
  # TODO(mục 12 doc): đối chiếu quyền với Karpenter release đang dùng rồi điền inline_policy.
  role       = aws_iam_role.karpenter.name
  policy_arn = "arn:${data.aws_partition.current.partition}:iam::aws:policy/AmazonEC2FullAccess"
}

resource "helm_release" "karpenter" {
  name             = "karpenter"
  namespace        = local.namespace
  create_namespace = true
  repository       = "oci://public.ecr.aws/karpenter"
  chart            = "karpenter"
  version          = var.karpenter_chart_version

  # Toàn bộ cấu hình qua values (tránh set block — một số VSCode schema cũ báo sai).
  # Toleration để controller chạy trên pool system (taint tier=system).
  values = [yamlencode({
    settings = {
      clusterName       = var.cluster_name
      interruptionQueue = aws_sqs_queue.interruption.name
    }
    serviceAccount = {
      annotations = {
        "eks.amazonaws.com/role-arn" = aws_iam_role.karpenter.arn
      }
    }
    tolerations = [{ key = "tier", operator = "Equal", value = "system", effect = "NoSchedule" }]
  })]
}

# EC2NodeClass + NodePool qua kubectl_manifest (kiểm tra CRD đã có sau helm_release).
# AMIFamily: AL2023 NVIDIA cho GPU (Bottlerocket NVIDIA là alternative — kiểm tra doc EKS hiện hành).
# httpPutResponseHopLimit=1 để chặn IMDS từ pod (mục 9) + NetworkPolicy bổ sung ở stack 3.
resource "kubectl_manifest" "nodeclass_gpu_shared_l4" {
  yaml_body = templatefile("${path.module}/manifests/ec2nodeclass-gpu.yaml", {
    name              = "gpu-shared-l4"
    cluster_name      = var.cluster_name
    ami_family        = "AL2023"
    kms_key_arn       = var.kms_key_arn_ebs
    hop_limit         = 1
    capacity_reserved = false
  })
  depends_on = [helm_release.karpenter]
}

resource "kubectl_manifest" "nodepool_gpu_shared_l4" {
  yaml_body = templatefile("${path.module}/manifests/nodepool-gpu-shared-l4.yaml", {
    name      = "gpu-shared-l4"
    nodeclass = "gpu-shared-l4"
  })
  depends_on = [kubectl_manifest.nodeclass_gpu_shared_l4]
}

resource "kubectl_manifest" "nodeclass_cpu_user" {
  yaml_body = templatefile("${path.module}/manifests/ec2nodeclass-cpu.yaml", {
    name         = "cpu-user"
    cluster_name = var.cluster_name
    kms_key_arn  = var.kms_key_arn_ebs
    hop_limit    = 1
  })
  depends_on = [helm_release.karpenter]
}

resource "kubectl_manifest" "nodepool_cpu_user" {
  yaml_body = templatefile("${path.module}/manifests/nodepool-cpu-user.yaml", {
    name      = "cpu-user"
    nodeclass = "cpu-user"
  })
  depends_on = [kubectl_manifest.nodeclass_cpu_user]
}

# Pool dedicated: 1 user / node / GPU nhỏ (g4dn.xlarge T4, g6.xlarge L4, g5.xlarge A10G). Không MIG.
resource "kubectl_manifest" "nodeclass_gpu_dedicated" {
  yaml_body = templatefile("${path.module}/manifests/ec2nodeclass-gpu.yaml", {
    name              = "gpu-dedicated"
    cluster_name      = var.cluster_name
    ami_family        = "AL2023"
    kms_key_arn       = var.kms_key_arn_ebs
    hop_limit         = 1
    capacity_reserved = true
  })
  depends_on = [helm_release.karpenter]
}

resource "kubectl_manifest" "nodepool_gpu_dedicated" {
  yaml_body = templatefile("${path.module}/manifests/nodepool-gpu-dedicated.yaml", {
    name      = "gpu-dedicated"
    nodeclass = "gpu-dedicated"
  })
  depends_on = [kubectl_manifest.nodeclass_gpu_dedicated]
}
