# Z2JH values — rendered via templatefile() in stack 03-hub-app/main.tf.
# Cross-check field names against the Z2JH chart version in use; do not infer from this file.
# Decisions applied: commit/ceiling VRAM, L4 shared replicas 3, userScheduler,
# do-not-disrupt, Cognito OIDC, external RDS, pre-created ALB + ACM (no Ingress).
#
# The Ingress block was removed on purpose: the ALB lives in 02-platform, so
# the chart must not create a second one. Traffic reaches the hub through the
# TargetGroupBinding defined in 03-hub-app/main.tf.
#
# GPU profiles are gated by `enable_gpu_profiles`. Terraform templates use
# HCL directive syntax (%%{ if } / %%{ endif }), NOT Go's {{ if }} - the
# latter would be emitted verbatim and break the YAML.

hub:
  allowNamedServers: true # BFF creates named servers via POST /hub/api/users/:user/servers/:name
  db:
    type: postgres
    url: ${hub_db_url} # RDS (Secrets Manager, not hard-coded)
  serviceAccount:
    annotations:
      eks.amazonaws.com/role-arn: ${hub_role_arn} # AssumeRole to the S3 workspace by prefix
  services:
    mlbox-bff:
      name: mlbox-bff
      api_token: ${bff_api_token}
  loadRoles:
    mlbox-bff:
      services:
        - mlbox-bff
      scopes:
        - list:users
        - read:users:name
        - read:servers
        - servers
        - admin:users
        - admin:servers
  config:
    # The authenticator class is set in extraConfig (20-bff-login). Users arrive from the dashboard with a
    # one-time code; the Hub never shows its own login page. Cognito is not used by the Hub.
    Authenticator:
      enable_auth_state: false # Hub stores no tokens; spawn is driven by the BFF (service token)
      # The BFF has already checked the dashboard session and issued the one-time code; without this
      # JupyterHub rejects every authenticated name as "unknown user" (no allowlist is configured).
      allow_all: true
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
          # VRAM balloon only applies to shared GPU pods (tier=shared nodes, time-sliced nvidia.com/gpu)
          if (pod.spec.node_selector or {}).get("tier") == "shared" and "nvidia.com/gpu" in limits:
              pod.metadata.annotations["vram.example.com/commit-mib"] = "${vram_commit_mib}"
              pod.metadata.annotations["vram.example.com/ceiling-mib"] = "${vram_ceiling_mib}"
          return pod
      c.KubeSpawner.modify_pod_hook = augment_pod

    # --- Dashboard -> Hub login (no Hub UI) ---
    # /hub/mlbox/login?code=...&next=... is reached from the dashboard. The code is one-time and
    # 60 s long; the Hub redeems it with the BFF over the cluster network (bridge token, never a browser cookie).
    20-bff-login: |
      import json as _json
      from jupyterhub.auth import Authenticator as _Authenticator
      from jupyterhub.handlers import BaseHandler as _BaseHandler
      from tornado.httpclient import AsyncHTTPClient as _HTTPClient, HTTPRequest as _HTTPRequest

      _BFF_REDEEM_URL = "${bff_internal_url}/internal/v1/hub/handoff/redeem"
      _BFF_BRIDGE_TOKEN = "${hub_auth_bridge_token}"
      _DASHBOARD_LOGIN_URL = "${dashboard_login_url}"

      class MlBoxLoginHandler(_BaseHandler):
          async def get(self):
              user = await self.login_user()
              if user is None:
                  # Missing, reused or expired code: the user signs in on the dashboard instead.
                  self.redirect(_DASHBOARD_LOGIN_URL)
                  return
              self.redirect(getattr(self, "mlbox_next", None) or "/hub/")

      class MlBoxBffAuthenticator(_Authenticator):
          auto_login = True

          def login_url(self, base_url):
              return base_url + "mlbox/login"

          def get_handlers(self, app):
              return [(r"/mlbox/login", MlBoxLoginHandler)]

          async def authenticate(self, handler, data=None):
              code = handler.get_argument("code", "")
              if not code or len(code) > 128:
                  return None
              request = _HTTPRequest(
                  _BFF_REDEEM_URL,
                  method="POST",
                  headers={"Authorization": "Bearer " + _BFF_BRIDGE_TOKEN, "Content-Type": "application/json"},
                  body=_json.dumps({"code": code}),
                  request_timeout=5,
              )
              response = await _HTTPClient().fetch(request, raise_error=False)
              if response.code != 200 or not response.body:
                  return None
              redeemed = _json.loads(response.body)
              # next is validated by the BFF (only /user/... paths); keep it for the redirect after login.
              handler.mlbox_next = redeemed.get("nextPath") or "/hub/"
              return redeemed.get("hubUsername") or None

      c.JupyterHub.authenticator_class = MlBoxBffAuthenticator

    # --- ML Box theme (Branding) — see deploy/hub-values-theme.patch.md ---
    # Templates override chỉ thay block; ChoiceLoader custom dir đứng trước,
    # JupyterHub tự nối default dir vào cuối nên {% extends "page.html" %}
    # vẫn resolve đúng template gốc.
    theming: |
      c.JupyterHub.template_paths = ["/etc/jupyterhub/custom/templates"]

      # Logo out-of-the-box: LogoHandler serve file tại {base_url}logo (/hub/logo).
      c.JupyterHub.logo_file = "/usr/local/share/jupyterhub/static/heroui/logo.svg"

      # template_vars: chỉ 'announcement' có hiệu lực built-in trong JH5;
      # 'hub_title'/'hub_subtitle'/'page_logo' là biến cho template override
      # của web/theme/hub/templates (chúng tự đọc trong Jinja).
      c.JupyterHub.template_vars = {
          "hub_title": "ML Box",
          "hub_subtitle": "GPU notebooks for teams",
          "page_logo": "hub/static/heroui/logo.svg",
          "announcement": "",
      }

  # --- ML Box theme mounts (ConfigMap tạo out-of-band, xem deploy/hub-values-theme.patch.md §3) ---
  extraVolumes:
    - name: hub-theme-templates
      configMap:
        name: hub-theme-templates
        optional: true # deploy values trước khi ConfigMap tồn tại vẫn chạy
    - name: hub-theme-static
      configMap:
        name: hub-theme-static
        optional: true

  extraVolumeMounts:
    - name: hub-theme-templates
      mountPath: /etc/jupyterhub/custom/templates
      readOnly: true
    # Static PHẢI nằm dưới data_files_path/static để tornado serve tại
    # /hub/static/heroui/... (KHÔNG có JupyterHub.extra_static_paths trên Hub).
    - name: hub-theme-static
      mountPath: /usr/local/share/jupyterhub/static/heroui
      readOnly: true

proxy:
  service:
    type: ClusterIP # ALB comes in via the TargetGroupBinding; no LoadBalancer service

singleuser:
  defaultUrl: /lab
  cpu:
    limit: 4
    guarantee: 0.5
  memory:
    limit: 8G
    guarantee: 1G
  storage:
    type: none # workspace ephemeral + sync via S3 sidecar (§7), no PVC
  extraEnv:
    TF_FORCE_GPU_ALLOW_GROWTH: "true"
    XLA_PYTHON_CLIENT_PREALLOCATE: "false"
  profileList:
    - display_name: "CPU · 2 vCPU"
      slug: cpu-small
      description: "2 vCPU, 4 GB RAM."
      default: true
      kubespawner_override:
        image: ${cpu_image}
        cpu_limit: 2
        cpu_guarantee: 0.5
        mem_limit: 4G
        mem_guarantee: 1G
        node_selector:
          karpenter.sh/nodepool: cpu-user
    - display_name: "CPU · 4 vCPU"
      slug: cpu-medium
      description: "4 vCPU, 8 GB RAM."
      kubespawner_override:
        image: ${cpu_image}
        cpu_limit: 4
        cpu_guarantee: 1
        mem_limit: 8G
        mem_guarantee: 2G
        node_selector:
          karpenter.sh/nodepool: cpu-user
    - display_name: "CPU · 8 vCPU"
      slug: cpu-large
      description: "8 vCPU, 16 GB RAM."
      kubespawner_override:
        image: ${cpu_image}
        cpu_limit: 8
        cpu_guarantee: 2
        mem_limit: 16G
        mem_guarantee: 4G
        node_selector:
          karpenter.sh/nodepool: cpu-user
%{ if enable_gpu_profiles ~}
    - display_name: "GPU shared L4 (commit/ceiling per config)"
      slug: gpu-l4-shared
      description: "L4 GPU split by time-slicing, best-effort, killed when exceeding the ceiling."
      kubespawner_override:
        image: ${gpu_image}
        cpu_limit: 4
        cpu_guarantee: 1
        mem_limit: 16G
        mem_guarantee: 4G
        extra_resource_limits:
          nvidia.com/gpu: "1"  # time-sliced replica on tier=shared nodes
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
    - display_name: "GPU dedicated (1 full GPU)"
      slug: gpu-dedicated
      description: "Small unshared GPU, no sharing. Requires plan=dedicated."
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
%{ endif ~}

scheduling:
  userScheduler:
    enabled: true # pack users onto fewer nodes (§5)
  podPriority:
    enabled: true
  userPlaceholder:
    enabled: true
    replicas: 2 # reduce scale-up wait; increase once p95 spawn is measured
  userPods:
    nodeAffinity:
      matchNodePurpose: require

cull:
  enabled: true
  timeout: 1800 # 30min for shared (§6: 30-60min, tune later)
  every: 300
  concurrency: 10
  users: false
