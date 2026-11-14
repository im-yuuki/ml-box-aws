# AWS Resource Map — JupyterHub GPU Sandbox (EKS, ap-southeast-2)

> Nguồn: scaffold `terraform/` hiện tại + trạng thái ngày 2026-11-14.
> Mũi tên `-->` = phụ thuộc / gọi tới. Nhóm `[...]` = service lẻ tham gia.
> `docs/aws-resource-map.png` regenerate 2026-11-14 từ bản Mermaid này (github.com/mermaid-js/mermaid-cli); bản Mermaid vẫn là nguồn chuẩn.

```mermaid
flowchart TB
    subgraph DNS_TLS["Ingress & DNS"]
        R53[Route53<br/>domain biến đầu vào]
        ACM[ACM<br/>TLS cho ALB]
        ALB[ALB<br/>AWS Load Balancer Controller]
        R53 --> ALB
        ACM --> ALB
    end

    subgraph NET["Network (VPC dual-stack)"]
        VPC[VPC 10.0.0.0/16<br/>+ IPv6 /56]
        PUB[Public subnets<br/>ALB + NAT]
        PRIV[Private subnets<br/>nodes / pods]
        NAT[NAT GW 1/AZ<br/>nat_mode: managed_per_az<br/>hoặc fck_nat / none]
        EIGW[Egress-only IGW<br/>IPv6 outbound free]
        S3EP[VPC Endpoint S3<br/>gateway, free]
        STSEP[VPC Endpoints<br/>STS + Logs + Monitoring]
        VPC --> PUB & PRIV
        PRIV --> NAT & EIGW & S3EP & STSEP
    end

    subgraph EKS["Compute — EKS"]
        CLUSTER[EKS Cluster + OIDC<br/>addons: vpc-cni prefix-deleg<br/>coredns kube-proxy<br/>ebs-csi pod-identity-agent]
        SYSMNG[Managed Node Group<br/>system: m6i CPU<br/>hub proxy karpenter]
        CPU_POOL[Karpenter NodePool<br/>cpu-user: m/c/r<br/>spot + on-demand]
        GSHARED[Karpenter NodePool<br/>gpu-shared-l4: g4dn (T4)<br/>time-slicing x2 @8GB]
        GDED[Karpenter NodePool<br/>gpu-dedicated: g4dn (T4)<br/>1 GPU/node, no MIG]
        SQS[SQS<br/>Spot interruption queue]
        EC2[EC2 instances<br/>Karpenter provisioned<br/>EBS gp3 KMS]
        CLUSTER --> SYSMNG & CPU_POOL & GSHARED & GDED
        CPU_POOL & GSHARED & GDED --> EC2
        SQS --> CLUSTER
        PRIV --> CLUSTER
    end

    subgraph APP["App & Data"]
        HUB[JupyterHub Z2JH<br/>hub proxy culler<br/>spawn hook VRAM]
        COG[Cognito User Pool<br/>hoặc OIDC ngoài<br/>claim user_id/plan/org_id]
        RDS[RDS PostgreSQL<br/>hub DB, backup auto]
        SM[Secrets Manager<br/>DB creds + hub secret]
        S3[S3 workspace bucket<br/>versioning lifecycle<br/>SSE-KMS, prefix spaces/{space}/projects/{project}]
        EFSM[EFS<br/>notebook home, PVC EFS/Project<br/>storageclass efs-sc]
        GHCR[GHCR (không ECR)<br/>image CPU/GPU + dashboard + BFF + admin]
        HUB --> COG & RDS & S3 & EFSM & GHCR
        RDS --> SM
        S3EP --> S3
        STSEP --> HUB
    end

    subgraph SEC_GOV["Security & Governance"]
        IAM[IAM Roles<br/>IRSA / Pod Identity<br/>least-privilege]
        KMS[KMS<br/>S3 RDS EBS]
        STS[STS AssumeRole<br/>session policy prefix<br/>cho sidecar S3]
        CW[CloudWatch<br/>/mlbox Fluent Bit + alarms<br/>+ SNS topic → email]
        PROM[kube-prometheus-stack<br/>namespace monitoring<br/>Prometheus + Alertmanager]
        BUD[AWS Budgets<br/>Console (chưa tạo trong code)]
        BKP[AWS Backup<br/>RDS retention + EFS]
        QUOTA[Service Quotas<br/>họ G/P xin sớm]
        IAM --> CLUSTER & HUB
        KMS --> S3 & RDS & EC2
        STS --> S3
        CW --> CLUSTER
        PROM --> CLUSTER
        PROM --> CW
    end

    ALB --> HUB
    SYSMNG --> HUB
    HUB --> GSHARED & GDED & CPU_POOL
```

## Bảng service lẻ (checklist xin quota / bật)

| Nhóm | Service | Dùng cho | Ghi chú chi phí Sydney |
|---|---|---|---|
| Network | VPC, Subnets, IGW, Egress-only IGW | dual-stack outbound-only | free |
| Network | NAT Gateway (1/AZ) / fck-nat / none | IPv4 outbound `nat_mode` | ~$43/NAT/tháng + $0.059/GB |
| Network | VPC Endpoints (S3 gw free; STS/Logs/Monitoring interface) | tránh phí NAT | ~$10/tháng/AZ/endpoint |
| DNS/TLS | Route53, ACM, ALB (LBC) | domain hub | ALB ~$25/tháng + LCU |
| Compute | EKS control plane | cluster | ~73 USD/tháng |
| Compute | EC2 g4dn.xlarge (T4) shared | time-slicing ×2 (commit 8GB) | ~$0.684/giờ (OD Sydney) |
| Compute | EC2 g4dn/g6/g5.xlarge dedicated | 1 GPU/node | theo giờ on-demand |
| Compute | EC2 m6i (system + cpu-user) | hub + CPU profiles | rẻ, cpu-user có Spot |
| Compute | EBS gp3 (KMS) | node + ephemeral buffer | theo GB |
| Orchestr. | Karpenter + SQS interruption | autoscale NodePools | free (chỉ EC2 + SQS) |
| Registry | GHCR (ghcr.io) | image CPU/GPU + scan (free cho public packages) | $0 |
| Data | EFS (efs-sc) + S3 workspace (versioning, SSE-KMS) | notebook home (PVC/Project) + artifacts | EFS theo GB; S3 theo sử dụng |
| Data | RDS PostgreSQL + AWS Backup | hub DB + usage DB snapshots/restore | instance + storage + backup |
| Auth | Cognito (hoặc OIDC ngoài) | đăng nhập, claim plan | theo MAU |
| Sec | IAM (IRSA/Pod Identity), STS, Secrets Manager, KMS | cô lập prefix, creds ngắn hạn | SM ~$0.4/secret/tháng |
| Obs | CloudWatch `/mlbox` (30d) + alarms, DCGM exporter, kube-prometheus-stack, SNS topic | log tập trung, GPU metrics, alert → email/SNS | logs + metrics |
| Gov | AWS Budgets (Console), Tags, Service Quotas | chốt chặn chi phí GPU | free |
