/**
 * Sandbox configurations a Project can start with. The `slug` is the value sent
 * to JupyterHub as the spawn option `profile`; it must match the `slug` of the
 * matching entry in terraform/stacks/03-hub-app/values/hub-values.yaml.tpl.
 */
export type SandboxProfileKind = "cpu" | "gpu";

export type SandboxProfile = {
  slug: string;
  label: string;
  description: string;
  kind: SandboxProfileKind;
  cpuCores: number;
  ramGb: number;
  gpu: string | null;
  /** GPU profiles stay hidden until the account has GPU quota (enable_gpu_profiles). */
  requiresGpu: boolean;
};

export const DEFAULT_SANDBOX_PROFILE = "cpu-small";

export const SANDBOX_PROFILES: readonly SandboxProfile[] = [
  { slug: "cpu-small", label: "CPU · 2 vCPU", description: "2 vCPU, 4 GB RAM", kind: "cpu", cpuCores: 2, ramGb: 4, gpu: null, requiresGpu: false },
  { slug: "cpu-medium", label: "CPU · 4 vCPU", description: "4 vCPU, 8 GB RAM", kind: "cpu", cpuCores: 4, ramGb: 8, gpu: null, requiresGpu: false },
  { slug: "cpu-large", label: "CPU · 8 vCPU", description: "8 vCPU, 16 GB RAM", kind: "cpu", cpuCores: 8, ramGb: 16, gpu: null, requiresGpu: false },
  { slug: "gpu-l4-shared", label: "GPU L4 (chia sẻ)", description: "4 vCPU, 16 GB RAM, 1 GPU L4 chia sẻ", kind: "gpu", cpuCores: 4, ramGb: 16, gpu: "L4 shared", requiresGpu: true },
  { slug: "gpu-dedicated", label: "GPU dedicated", description: "1 GPU riêng", kind: "gpu", cpuCores: 4, ramGb: 16, gpu: "dedicated", requiresGpu: true },
];

export type AvailableSandboxProfile = SandboxProfile & { available: boolean };

/** GPU profiles are offered only when the deployment enables them. */
export function listSandboxProfiles(gpuEnabled: boolean): AvailableSandboxProfile[] {
  return SANDBOX_PROFILES.map((profile) => ({ ...profile, available: !profile.requiresGpu || gpuEnabled }));
}

export type ProfileResolution =
  | { ok: true; profile: SandboxProfile }
  | { ok: false; error: "UNKNOWN_PROFILE" | "PROFILE_UNAVAILABLE" };

/** Resolves a requested slug; an absent request falls back to the default CPU profile. */
export function resolveSandboxProfile(requested: unknown, gpuEnabled: boolean): ProfileResolution {
  const slug = typeof requested === "string" && requested.length > 0 ? requested : DEFAULT_SANDBOX_PROFILE;
  const profile = SANDBOX_PROFILES.find((item) => item.slug === slug);
  if (!profile) return { ok: false, error: "UNKNOWN_PROFILE" };
  if (profile.requiresGpu && !gpuEnabled) return { ok: false, error: "PROFILE_UNAVAILABLE" };
  return { ok: true, profile };
}
