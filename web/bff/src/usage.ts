export type UsageTracking = "not-tracked" | "allocated-footprint" | "not-available" | "disabled";

export type UsageServer = {
  name: string;
  state: "running" | "pending" | "stopped";
  url: string | null;
  lastActivity: string | null;
  cpuCoresAllocated: number | null;
  ramGbAllocated: number | null;
};

export type UsageQuotas = {
  cpuHours: number;
  ramGb: number;
  storageGb: number;
  gpuHours: number;
};

export type UsageResponse = {
  generatedAt: string;
  history?: Array<{ sampledAt: string; runningServers: number; cpuCoresAllocated: number | null; ramGbAllocated: number | null }>;
  historyAvailable?: boolean;
  quota: {
    cpuHours: { limit: number; unit: "cpu-hours"; usage: null; tracking: "not-tracked" };
    ramGb: { limit: number; unit: "GB"; usage: number | null; tracking: "allocated-footprint" };
    storageGb: { limit: number; unit: "GB"; usage: null; tracking: "not-available" };
    gpuHours: { limit: number; unit: "gpu-hours"; usage: null; tracking: "disabled" };
  };
  footprint: {
    runningServers: number;
    pendingServers: number;
    cpuCoresAllocated: number | null;
    ramGbAllocated: number | null;
    servers: UsageServer[];
  };
};

export type RamQuotaDecision =
  | { allowed: true; enforcement: "enforced" | "degraded"; currentGb?: number; limitGb: number }
  | { allowed: false; enforcement: "enforced"; currentGb: number; requestedGb: number; limitGb: number };

/** Fail open when current allocation cannot be established; otherwise enforce the default CPU profile's 1 GiB guarantee. */
export function checkRamQuota(servers: UsageServer[], limitGb: number, requestedGb = 1): RamQuotaDecision {
  const active = servers.filter((server) => server.state === "running" || server.state === "pending");
  const known = active.every((server) => server.ramGbAllocated !== null);
  if (!known) return { allowed: true, enforcement: "degraded", limitGb };
  const currentGb = active.reduce((sum, server) => sum + (server.ramGbAllocated ?? 0), 0);
  if (currentGb + requestedGb > limitGb) {
    return { allowed: false, enforcement: "enforced", currentGb, requestedGb, limitGb };
  }
  return { allowed: true, enforcement: "enforced", currentGb, limitGb };
}

function sumKnown(values: Array<number | null>, emptyValue: number): number | null {
  if (values.length === 0) return emptyValue;
  return values.every((value) => value !== null) ? values.reduce((sum, value) => sum + (value ?? 0), 0) : null;
}

export function buildUsageResponse(servers: UsageServer[], quotas: UsageQuotas, generatedAt = new Date().toISOString()): UsageResponse {
  const running = servers.filter((server) => server.state === "running");
  const pending = servers.filter((server) => server.state === "pending");
  const cpuCoresAllocated = sumKnown(running.map((server) => server.cpuCoresAllocated), 0);
  const ramGbAllocated = sumKnown(running.map((server) => server.ramGbAllocated), 0);

  return {
    generatedAt,
    quota: {
      cpuHours: { limit: quotas.cpuHours, unit: "cpu-hours", usage: null, tracking: "not-tracked" },
      ramGb: { limit: quotas.ramGb, unit: "GB", usage: ramGbAllocated, tracking: "allocated-footprint" },
      storageGb: { limit: quotas.storageGb, unit: "GB", usage: null, tracking: "not-available" },
      gpuHours: { limit: quotas.gpuHours, unit: "gpu-hours", usage: null, tracking: "disabled" },
    },
    footprint: {
      runningServers: running.length,
      pendingServers: pending.length,
      cpuCoresAllocated,
      ramGbAllocated,
      servers,
    },
  };
}

export function parseCpuCores(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) && value >= 0 ? value : null;
  if (typeof value !== "string") return null;
  const match = value.trim().match(/^([0-9]+(?:\.[0-9]+)?)(m|millicores?)?$/i);
  if (!match) return null;
  const parsed = Number(match[1]);
  if (!Number.isFinite(parsed) || parsed < 0) return null;
  return match[2]?.toLowerCase().startsWith("m") ? parsed / 1000 : parsed;
}

export function parseMemoryGb(value: unknown): number | null {
  if (typeof value !== "string") return null;
  const match = value.trim().match(/^([0-9]+(?:\.[0-9]+)?)(k|ki|m|mi|g|gi|t|ti)b?$/i);
  if (!match) return null;
  const parsed = Number(match[1]);
  if (!Number.isFinite(parsed) || parsed < 0) return null;
  const unit = match[2].toLowerCase();
  const factors: Record<string, number> = {
    k: 1 / (1024 * 1024), ki: 1 / (1024 * 1024),
    m: 1 / 1024, mi: 1 / 1024,
    g: 1, gi: 1,
    t: 1024, ti: 1024,
  };
  return parsed * factors[unit];
}
