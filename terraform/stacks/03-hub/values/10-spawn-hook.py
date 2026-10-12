# Spawn hook Z2JH (hub.extraConfig) — tham khảo để gắn vào helm_release ở stack 03.
# Verify API KubeSpawner/Authenticator theo chart version đang dùng.
# Nhiệm vụ: lọc profile theo claim plan, gắn annotation VRAM + label chi phí, đếm quota.

async def augment_pod(spawner, pod):
    auth_state = await spawner.user.get_auth_state()
    plan = (auth_state or {}).get("plan", "shared")
    user_id = spawner.user.name
    org_id = (auth_state or {}).get("org_id", "unknown")

    pod.metadata.annotations["karpenter.sh/do-not-disrupt"] = "true"
    pod.metadata.labels["plan"] = plan
    pod.metadata.labels["user"] = user_id
    pod.metadata.labels["org"] = org_id

    if plan == "shared":
        pod.metadata.annotations["vram.example.com/commit-mib"] = "8192"
        pod.metadata.annotations["vram.example.com/ceiling-mib"] = "12288"
        # nodeSelector/tolerations/resources đã có trong profileList;
        # hook chỉ bổ sung nếu user đổi profile thủ công.
    return pod

# c.KubeSpawner.pre_spawn_hook = augment_pod  (đặt trong extraConfig)
# Quota giờ GPU / số phiên đồng thời: đếm trong hook này (Z2JH 1 namespace
# nên ResourceQuota K8s khó chia theo user — mục 6 doc).
