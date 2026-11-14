# 06-storage — EFS-backed notebook storage for sandboxes

Applies the EFS file system, the EFS CSI driver addon, the `efs-sc` StorageClass and the IAM role the
CSI driver uses. The JupyterHub stack (03-hub-app) creates one PVC per Project with that StorageClass,
so this stack must be applied before 03-hub-app.

Prerequisites: 01-foundation (VPC + EKS) must exist. The cluster and the private subnets are discovered
from the project/env/region naming rule, so no other input is required.

```bash
terraform init -backend-config=backend.hcl
terraform plan
terraform apply
```

Verify:
```bash
kubectl get storageclass efs-sc
kubectl get pods -n kube-system -l app=aws-efs-csi-driver
```

Notes: the file system is single-AZ (one mount target, IPv4) on purpose — DNS64 resolves the EFS name to a
NAT64 address in the private subnets and NFS mounts hang over it. 00-bootstrap generates the backend.hcl of
this stack; the committed backend.hcl.example is only a manual fallback. Destroying this stack deletes the
file system and every notebook file stored in it.
