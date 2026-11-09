# Shared EFS for sandbox home directories. NFS works across AZs, so a Project's notebook can start on any
# node. Each Project gets its own access point (one directory) through dynamic provisioning, and deleting
# the PVC deletes that directory (deleteAccessPointRootDir).

data "aws_partition" "current" {}

resource "aws_efs_file_system" "sandbox" {
  creation_token   = "${var.cluster_name}-sandbox-files"
  encrypted        = true
  performance_mode = "generalPurpose"
  throughput_mode  = "elastic"

  lifecycle_policy {
    transition_to_ia = "AFTER_30_DAYS"
  }

  tags = merge(var.tags, { Name = "${var.cluster_name}-sandbox-files" })
}

# Automatic backups, so files are recoverable beyond the sandbox lifetime.
resource "aws_efs_backup_policy" "sandbox" {
  file_system_id = aws_efs_file_system.sandbox.id

  backup_policy {
    status = "ENABLED"
  }
}

resource "aws_security_group" "efs" {
  name        = "${var.cluster_name}-sandbox-efs"
  description = "NFS from the VPC to the sandbox EFS mount targets"
  vpc_id      = var.vpc_id

  ingress {
    description = "NFS from the VPC"
    from_port   = 2049
    to_port     = 2049
    protocol    = "tcp"
    cidr_blocks = [var.vpc_cidr]
  }

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = var.tags
}

# One mount target per subnet (one per AZ). Pods reach EFS through these.
resource "aws_efs_mount_target" "private" {
  for_each        = toset(var.private_subnet_ids)
  file_system_id  = aws_efs_file_system.sandbox.id
  subnet_id       = each.value
  security_groups = [aws_security_group.efs.id]
}

# IRSA for the EFS CSI controller (kube-system:efs-csi-controller-sa). It creates and deletes access points.
resource "aws_iam_role" "efs_csi" {
  name = "${var.cluster_name}-efs-csi"
  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Federated = var.oidc_provider_arn }
      Action    = "sts:AssumeRoleWithWebIdentity"
      Condition = {
        StringEquals = {
          "${var.oidc_issuer_host}:sub" = "system:serviceaccount:kube-system:efs-csi-controller-sa"
          "${var.oidc_issuer_host}:aud" = "sts.amazonaws.com"
        }
      }
    }]
  })
  tags = var.tags
}

resource "aws_iam_role_policy_attachment" "efs_csi" {
  role       = aws_iam_role.efs_csi.name
  policy_arn = "arn:${data.aws_partition.current.partition}:iam::aws:policy/service-role/AmazonEFSCSIDriverPolicy"
}

resource "aws_eks_addon" "efs_csi" {
  cluster_name                = var.cluster_name
  addon_name                  = "aws-efs-csi-driver"
  service_account_role_arn    = aws_iam_role.efs_csi.arn
  resolve_conflicts_on_update = "OVERWRITE"
  # The StorageClass flag alone does not remove the access point root directory. The controller flag does,
  # so deleting a Project frees its files, not only its access point.
  configuration_values = jsonencode({
    controller = { deleteAccessPointRootDir = true }
  })
  tags = var.tags
}

# Notebooks run as uid/gid 1000 (singleuser.uid in the Hub values). Each access point is owned by that user.
resource "kubectl_manifest" "efs_storage_class" {
  depends_on = [aws_eks_addon.efs_csi, aws_efs_mount_target.private]

  yaml_body = yamlencode({
    apiVersion = "storage.k8s.io/v1"
    kind       = "StorageClass"
    metadata   = { name = var.storage_class_name }
    provisioner = "efs.csi.aws.com"
    parameters = {
      provisioningMode         = "efs-ap"
      fileSystemId             = aws_efs_file_system.sandbox.id
      directoryPerms           = "700"
      uid                      = "1000"
      gid                      = "1000"
      deleteAccessPointRootDir = "true"
    }
    # Mount over IPv4 through one mount target. Hosts resolve the EFS name to a NAT64 address (DNS64 is on in
    # this VPC), and NFS over NAT64 hangs. The IP is a mount target in the first private subnet; NFS works
    # across AZs. Move to IPv6 mount targets or turn DNS64 off to remove the single-AZ dependency.
    mountOptions      = ["mounttargetip=${aws_efs_mount_target.private[sort(var.private_subnet_ids)[0]].ip_address}"]
    reclaimPolicy     = "Delete"
    volumeBindingMode = "Immediate"
  })
}
