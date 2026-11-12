// Pure helpers for the capacity and storage pages, kept apart from the clients so they can be tested.

export type QuotaFamily = "gvt" | "standard" | "other";

/**
 * The EC2 vCPU quota an instance type counts against. G and VT instances have their own quota; the standard
 * families (A, C, D, H, I, M, R, T, Z) share one. Other families (P, Inf, Trn, X...) have separate quotas that the
 * console does not track.
 */
export function quotaFamily(instanceType: string): QuotaFamily {
  const family = instanceType.split(".")[0].toLowerCase();
  if (/^(g|vt)\d/.test(family)) return "gvt";
  if (/^[acdhimrtz]\d/.test(family)) return "standard";
  return "other";
}

export type ContainerResources = { resources?: { requests?: Record<string, string>; limits?: Record<string, string> } };

/** GPUs a pod asks for. A GPU can only be requested as a limit, so the limit is read when there is no request. */
export function podGpuRequest(containers: ContainerResources[] | undefined): number {
  let total = 0;
  for (const container of containers ?? []) {
    const value = container.resources?.requests?.["nvidia.com/gpu"] ?? container.resources?.limits?.["nvidia.com/gpu"];
    const count = Number(value ?? 0);
    if (Number.isFinite(count)) total += count;
  }
  return total;
}

export type PodCondition = { type: string; status: string; reason?: string; message?: string };

/** Why a pod is not scheduled, as the scheduler reported it. */
export function unschedulableReason(conditions: PodCondition[] | undefined): { reason: string; message: string } | null {
  const scheduled = conditions?.find((condition) => condition.type === "PodScheduled" && condition.status === "False");
  if (!scheduled) return null;
  return { reason: scheduled.reason ?? "Unschedulable", message: (scheduled.message ?? "").slice(0, 240) };
}

export type QuotaUsage = { code: string; family: QuotaFamily; lifecycle: "on-demand" | "spot"; limit: number | null; used: number };

export type QuotaLevel = "ok" | "warn" | "error";

/** A quota is a warning from 80 percent and full at 100: at that point the next node cannot start. */
export function quotaLevel(limit: number | null, used: number): QuotaLevel {
  if (limit === null || limit <= 0) return "error";
  const ratio = used / limit;
  if (ratio >= 1) return "error";
  return ratio >= 0.8 ? "warn" : "ok";
}

export type VolumeClaimRow = { namespace: string; name: string; phase: string; size: string | null; storageClass: string | null; serverName: string | null };
export type KnownProject = { name: string; spaceName: string; deleted: boolean };

export type ClaimStatus = "ok" | "deletedProject" | "unknownProject" | "unlabelled";

/**
 * Notebook storage is one claim per Project; the Hub writes the Project id into the claim as its server name. A claim
 * whose Project is gone or soft-deleted keeps its EFS directory, so those are the ones worth cleaning up.
 */
export function classifyClaim(claim: VolumeClaimRow, projects: Map<string, KnownProject>): { status: ClaimStatus; project: KnownProject | null } {
  if (!claim.serverName) return { status: "unlabelled", project: null };
  const project = projects.get(claim.serverName) ?? null;
  if (!project) return { status: "unknownProject", project: null };
  return { status: project.deleted ? "deletedProject" : "ok", project };
}

export function parseStorageToGiB(size: string | null): number | null {
  if (!size) return null;
  const match = size.match(/^(\d+(?:\.\d+)?)(Ki|Mi|Gi|Ti|K|M|G|T)?$/);
  if (!match) return null;
  const value = Number(match[1]);
  const factors: Record<string, number> = { "": 1 / 2 ** 30, Ki: 1 / 2 ** 20, Mi: 1 / 2 ** 10, Gi: 1, Ti: 1024, K: 1e3 / 2 ** 30, M: 1e6 / 2 ** 30, G: 1e9 / 2 ** 30, T: 1e12 / 2 ** 30 };
  return value * factors[match[2] ?? ""];
}
