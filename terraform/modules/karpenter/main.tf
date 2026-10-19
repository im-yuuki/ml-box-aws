# Karpenter: IAM + SQS interruption + Helm + EC2NodeClass/NodePool.
# Doesn't use EKS Auto Mode (needs to share GPUs + control AMI/NodePool — doc §2).
# No MIG manager installed (temporary decision).

locals {
  namespace = "karpenter"
}

# SQS queue receiving Spot interruptions — used by the cpu-user pool (GPU user sessions don't use Spot).
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

# The controller policy lives in controller-policy.tf (translated from the standard CloudFormation v1.15.0).
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

resource "helm_release" "karpenter" {
  name             = "karpenter"
  namespace        = local.namespace
  create_namespace = true
  repository       = "oci://public.ecr.aws/karpenter"
  chart            = "karpenter"
  version          = var.karpenter_chart_version

  # All configuration via values (avoid the set block — some older VSCode schemas report it wrong).
  # Toleration lets the controller run on the system pool (taint tier=system).
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

# EC2NodeClass + NodePool via kubectl_manifest (CRDs are in place after helm_release).
# AMIFamily: AL2023 NVIDIA for GPU (Bottlerocket NVIDIA is an alternative — check current EKS docs).
# httpPutResponseHopLimit=1 to block IMDS from pods (§9) + extra NetworkPolicy in stack 3.
resource "kubectl_manifest" "nodeclass_gpu_shared_l4" {
  yaml_body = templatefile("${path.module}/manifests/ec2nodeclass-gpu.yaml", {
    name              = "gpu-shared-l4"
    cluster_name      = var.cluster_name
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

# Dedicated pool: 1 user / node / small GPU (g4dn.xlarge T4, g6.xlarge L4, g5.xlarge A10G). No MIG.
resource "kubectl_manifest" "nodeclass_gpu_dedicated" {
  yaml_body = templatefile("${path.module}/manifests/ec2nodeclass-gpu.yaml", {
    name              = "gpu-dedicated"
    cluster_name      = var.cluster_name
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
