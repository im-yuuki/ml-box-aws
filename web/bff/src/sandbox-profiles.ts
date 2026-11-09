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

// Instance codenames follow EC2 naming: family and size. Families: c = CPU, g = GPU shared, d = GPU dedicated;
// the digit is the generation (1 = first MLBox generation). The slug stays the
// stable key stored with runs and sent to the Hub; the codename is what people read.
export const SANDBOX_PROFILES: readonly SandboxProfile[] = [
  { slug: "cpu-small", label: "c1.large", description: "2 vCPU · 4 GB RAM · CPU", kind: "cpu", cpuCores: 2, ramGb: 4, gpu: null, requiresGpu: false },
  { slug: "cpu-medium", label: "c1.xlarge", description: "4 vCPU · 8 GB RAM · CPU", kind: "cpu", cpuCores: 4, ramGb: 8, gpu: null, requiresGpu: false },
  { slug: "cpu-large", label: "c1.2xlarge", description: "8 vCPU · 16 GB RAM · CPU", kind: "cpu", cpuCores: 8, ramGb: 16, gpu: null, requiresGpu: false },
  { slug: "gpu-l4-shared", label: "g1.xlarge", description: "4 vCPU · 16 GB RAM · 1 GPU T4 chia sẻ", kind: "gpu", cpuCores: 4, ramGb: 16, gpu: "T4 shared", requiresGpu: true },
  { slug: "gpu-dedicated", label: "d1.xlarge", description: "4 vCPU · 16 GB RAM · 1 GPU T4 riêng", kind: "gpu", cpuCores: 4, ramGb: 16, gpu: "dedicated", requiresGpu: true },
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
