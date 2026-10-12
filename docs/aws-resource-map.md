# AWS Resource Map — JupyterHub GPU Sandbox (EKS, ap-southeast-2)

> Nguồn: mục 4 doc handoff + scaffold `terraform/` hiện tại.
> Mũi tên `-->` = phụ thuộc / gọi tới. Nhóm `[...]` = service lẻ tham gia.

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
        ECREP[VPC Endpoints<br/>ECR api + dkr]
        STSEP[VPC Endpoints<br/>STS + Logs + Monitoring]
        VPC --> PUB & PRIV
        PRIV --> NAT & EIGW & S3EP & ECREP & STSEP
    end

    subgraph EKS["Compute — EKS"]
        CLUSTER[EKS Cluster + OIDC<br/>addons: vpc-cni prefix-deleg<br/>coredns kube-proxy<br/>ebs-csi pod-identity-agent]
        SYSMNG[Managed Node Group<br/>system: m6i CPU<br/>hub proxy karpenter]
        CPU_POOL[Karpenter NodePool<br/>cpu-user: m/c/r<br/>spot + on-demand]
        GSHARED[Karpenter NodePool<br/>gpu-shared-l4: g6<br/>time-slicing x3]
        GDED[Karpenter NodePool<br/>gpu-dedicated: g4dn/g6/g5<br/>1 GPU/node, no MIG]
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
        S3[S3 workspace bucket<br/>versioning lifecycle<br/>SSE-KMS, prefix users/id]
        ECR[ECR repositories<br/>CPU + GPU images<br/>lifecycle + scan]
        HUB --> COG & RDS & S3 & ECR
        RDS --> SM
        S3EP --> S3
        ECREP --> ECR
        STSEP --> HUB
    end

    subgraph SEC_GOV["Security & Governance"]
        IAM[IAM Roles<br/>IRSA / Pod Identity<br/>least-privilege]
        KMS[KMS<br/>S3 RDS EBS]
        STS[STS AssumeRole<br/>session policy prefix<br/>cho sidecar S3]
        CW[CloudWatch<br/>logs + metrics<br/>DCGM + vram-guard]
        BUD[AWS Budgets<br/>cảnh báo ngưỡng]
        BKP[AWS Backup<br/>RDS retention]
        QUOTA[Service Quotas<br/>họ G/P xin sớm]
        IAM --> CLUSTER & HUB
        KMS --> S3 & RDS & EC2
        STS --> S3
        CW --> CLUSTER
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
| Network | VPC Endpoints (S3 gw free; ECR/STS/Logs/Monitoring interface) | tránh phí NAT | ~$10/tháng/AZ/endpoint |
| DNS/TLS | Route53, ACM, ALB (LBC) | domain hub | ALB ~$25/tháng + LCU |
| Compute | EKS control plane | cluster | ~73 USD/tháng |
| Compute | EC2 g6.xlarge (L4) shared | time-slicing ×3 | theo giờ on-demand |
| Compute | EC2 g4dn/g6/g5.xlarge dedicated | 1 GPU/node | theo giờ on-demand |
| Compute | EC2 m6i (system + cpu-user) | hub + CPU profiles | rẻ, cpu-user có Spot |
| Compute | EBS gp3 (KMS) | node + ephemeral buffer | theo GB |
| Orchestr. | Karpenter + SQS interruption | autoscale NodePools | free (chỉ EC2 + SQS) |
| Registry | ECR | image CPU/GPU + scan | storage + API |
| Data | S3 workspace (versioning, lifecycle, SSE-KMS) | backup workspace + quota | storage + request |
| Data | RDS PostgreSQL + AWS Backup | hub DB | instance + storage + backup |
| Auth | Cognito (hoặc OIDC ngoài) | đăng nhập, claim plan | theo MAU |
| Sec | IAM (IRSA/Pod Identity), STS, Secrets Manager, KMS | cô lập prefix, creds ngắn hạn | SM ~$0.4/secret/tháng |
| Obs | CloudWatch, DCGM exporter, vram-guard metrics | Xid, VRAM/pod, kill events | logs + metrics |
| Gov | AWS Budgets, Tags, Service Quotas | chốt chặn chi phí GPU | free |
