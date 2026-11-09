import type { SandboxProfileOption } from "@/hooks/useProjectSandbox";

export type InstanceKind = "cpu" | "gpu";

/** CPU or GPU for a profile slug. Uses the loaded catalogue when available, otherwise the slug prefix. */
export function instanceKindFor(slug: string, profiles: SandboxProfileOption[] = []): InstanceKind {
  const known = profiles.find((profile) => profile.slug === slug);
  if (known) return known.kind;
  return slug.startsWith("gpu-") ? "gpu" : "cpu";
}

/** The EC2-style codename shown to people; falls back to the slug until the catalogue loads. */
export function instanceLabelFor(slug: string, profiles: SandboxProfileOption[] = []): string {
  return profiles.find((profile) => profile.slug === slug)?.label ?? slug;
}
