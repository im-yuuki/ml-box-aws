# Z2JH values — template qua templatefile() ở stack 03-hub/main.tf.
# Đối chiếu tên field với chart Z2JH version đang dùng (mục 12 doc), không suy từ file này.
# Chốt đã áp: commit 8192 MiB / ceiling 12288 MiB, L4 shared replicas 3, userScheduler,
# do-not-disrupt, NetworkPolicy/IMDS ở tầng cluster (stack 01).

hub:
  db:
    type: postgres
    url: ${hub_db_url} # RDS Postgres từ module hub-db (Secrets Manager, không hard-code)

singleuser:
  defaultUrl: /lab
  cpu:
    limit: 4
    guarantee: 0.5
  memory:
    limit: 8G
    guarantee: 1G
  storage:
    type: none # workspace ephemeral + sync S3 sidecar (mục 7), không PVC
  extraEnv:
    TF_FORCE_GPU_ALLOW_GROWTH: "true"
    XLA_PYTHON_CLIENT_PREALLOCATE: "false"
  profileList:
    - display_name: "CPU nhỏ"
      description: "Không GPU, học Python cơ bản."
      default: true
      kubespawner_override:
        image: ${cpu_image}
        cpu_limit: 2
        cpu_guarantee: 0.5
        mem_limit: 4G
        mem_guarantee: 1G
        node_selector:
          karpenter.sh/nodepool: cpu-user
    - display_name: "GPU shared L4 (8GB commit / 12GB ceiling)"
      description: "Chia GPU L4 bằng time-slicing, best-effort, kill khi vượt ceiling."
      kubespawner_override:
        image: ${gpu_image}
        cpu_limit: 4
        cpu_guarantee: 1
        mem_limit: 16G
        mem_guarantee: 4G
        extra_resource_limits:
          nvidia.com/gpu.shared: "1"
        node_selector:
          tier: shared
          gpu-family: L4
        tolerations:
          - key: tier
            operator: Equal
            value: shared
            effect: NoSchedule
        extra_annotations:
          karpenter.sh/do-not-disrupt: "true"
          vram.example.com/commit-mib: "8192"
          vram.example.com/ceiling-mib: "12288"
        extra_labels:
          plan: shared
        extra_env:
          VRAM_COMMIT_MIB: "8192"
          VRAM_CEILING_MIB: "12288"
    - display_name: "GPU dedicated (1 GPU riêng)"
      description: "Nguyên GPU nhỏ, không chia sẻ. Cần quyền plan=dedicated."
      kubespawner_override:
        image: ${gpu_image}
        extra_resource_limits:
          nvidia.com/gpu: "1"
        node_selector:
          tier: dedicated
        tolerations:
          - key: tier
            operator: Equal
            value: dedicated
            effect: NoSchedule
        extra_annotations:
          karpenter.sh/do-not-disrupt: "true"
        extra_labels:
          plan: dedicated

scheduling:
  userScheduler:
    enabled: true # dồn user vào ít node (mục 5)
  podPriority:
    enabled: true
  userPlaceholder:
    enabled: true
    replicas: 2 # giảm chờ scale-up; tăng khi đo p95 spawn
  userPods:
    nodeAffinity:
      matchNodePurpose: require

cull:
  enabled: true
  timeout: 1800 # 30p cho shared (mục 6: 30-60p tinh chỉnh sau)
  every: 300
  concurrency: 10
  users: false

# Spawn hook động (lọc profile theo plan, gắn label user/org, quota giờ GPU):
# viết ở hub.extraConfig trong stack 03-hub/main.tf — xem 10-spawn-hook.py.
# Claim IdP cần: user_id, plan (shared|dedicated), org_id (chỉ tính phí, mục 6).
