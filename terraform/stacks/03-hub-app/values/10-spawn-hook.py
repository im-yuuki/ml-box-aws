# Z2JH spawn hook (hub.extraConfig) — reference for attaching to the helm_release in stack 03-hub-app.
# Verify KubeSpawner/Authenticator APIs against the chart version in use.
# Responsibilities: filter the profile by the plan claim, attach VRAM annotations + cost labels, count quota.

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
        # nodeSelector/tolerations/resources are already set in profileList;
        # the hook only adds these if the user switches profile manually.
    return pod

# c.KubeSpawner.pre_spawn_hook = augment_pod  (put inside extraConfig)
# GPU-hours / concurrent-session quota: count within this hook (Z2JH runs 1
# namespace, so K8s ResourceQuota is hard to split per user — handoff doc §6).
