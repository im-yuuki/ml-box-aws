# Z2JH values — rendered via templatefile() in stack 03-hub/main.tf.
# Cross-check field names against the Z2JH chart version in use (handoff doc §12); do not infer from this file.
# Decisions applied: commit/ceiling VRAM, L4 shared replicas 3, userScheduler,
# do-not-disrupt, Cognito OIDC, external RDS, ALB + ACM.

hub:
  db:
    type: postgres
    url: ${hub_db_url} # RDS (Secrets Manager, not hard-coded)
  serviceAccount:
    annotations:
      eks.amazonaws.com/role-arn: ${hub_role_arn} # AssumeRole to the S3 workspace by prefix
  config:
    JupyterHub:
      authenticator_class: generic-oauth
    GenericOAuthenticator:
      login_service: AWS Cognito
      allow_all: true # lab: every newly registered user gets access (prod locks down via allowlist/groups)
      client_id: ${cognito_client_id}
      client_secret: ${cognito_client_secret}
      oauth_callback_url: https://${hub_host}/hub/oauth_callback
      authorize_url: ${cognito_authorize_url}
      token_url: ${cognito_token_url}
      userdata_url: ${cognito_userdata_url}
      userdata_method: GET
      scope:
        - openid
        - email
        - profile
      username_key: email
      enable_auth_state: true
  extraConfig:
    10-spawn-hook: |
      # Attach VRAM annotations + cost labels + do-not-disrupt to each user pod.
      # Full plan/org claims come in a later step (Cognito pre-token hook); lab uses plan=shared.
      import re as _re

      def _label_safe_username(name):
          # K8s label values: only [A-Za-z0-9._-], must start and end alphanumeric.
          safe = _re.sub(r"[^A-Za-z0-9._-]+", "-", name).strip("._-")
          safe = _re.sub(r"[^A-Za-z0-9._-]+$", "", safe)
          return safe[:63] or "anonymous"

      async def augment_pod(spawner, pod):
          # Called as KubeSpawner.modify_pod_hook with (spawner, pod).
          # Profiles already set plan/do-not-disrupt via extra_labels/extra_annotations.
          pod.metadata.labels["user"] = _label_safe_username(spawner.user.name)
          limits = pod.spec.containers[0].resources.limits or {}
          if "nvidia.com/gpu.shared" in limits: # VRAM balloon only applies to shared GPU pods
              pod.metadata.annotations["vram.example.com/commit-mib"] = "${vram_commit_mib}"
              pod.metadata.annotations["vram.example.com/ceiling-mib"] = "${vram_ceiling_mib}"
          return pod
      c.KubeSpawner.modify_pod_hook = augment_pod

proxy:
  service:
    type: ClusterIP # ALB đi qua Ingress, không dùng LoadBalancer service

ingress:
  enabled: true
  annotations:
    kubernetes.io/ingress.class: alb
    alb.ingress.kubernetes.io/scheme: internet-facing
    alb.ingress.kubernetes.io/target-type: ip
    alb.ingress.kubernetes.io/certificate-arn: ${cert_arn} # ACM miễn phí
    alb.ingress.kubernetes.io/listen-ports: '[{"HTTPS":443}]'
    alb.ingress.kubernetes.io/ssl-redirect: "443"
  hosts:
    - ${hub_host}
  tls:
    - hosts:
        - ${hub_host}
      # Placeholder: ALB dùng cert ACM ở annotation, bỏ qua secret này.
      secretName: hub-tls-placeholder

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
    - display_name: "GPU shared L4 (commit/ceiling theo cấu hình)"
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
          vram.example.com/commit-mib: "${vram_commit_mib}"
          vram.example.com/ceiling-mib: "${vram_ceiling_mib}"
        extra_labels:
          plan: shared
        extra_env:
          VRAM_COMMIT_MIB: "${vram_commit_mib}"
          VRAM_CEILING_MIB: "${vram_ceiling_mib}"
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
