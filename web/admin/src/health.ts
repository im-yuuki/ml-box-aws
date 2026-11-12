import type { HealthTarget } from "./config.js";

export type HealthResult = { name: string; url: string; ok: boolean; status: number | null; latencyMs: number | null; error?: string };

/** Probes run from inside the cluster, so internal Service URLs are reachable as well as public ones. */
export async function probe(target: HealthTarget, fetchImpl: typeof fetch = fetch, timeoutMs = 4000): Promise<HealthResult> {
  const started = Date.now();
  try {
    const response = await fetchImpl(target.url, { method: "GET", redirect: "manual", signal: AbortSignal.timeout(timeoutMs) });
    await response.body?.cancel();
    // Redirects to a login page are healthy answers; only 4xx/5xx mean the service is unhappy.
    return { ...target, ok: response.status < 400, status: response.status, latencyMs: Date.now() - started };
  } catch (error) {
    return { ...target, ok: false, status: null, latencyMs: null, error: error instanceof Error ? error.name : "error" };
  }
}

export function probeAll(targets: HealthTarget[], fetchImpl: typeof fetch = fetch): Promise<HealthResult[]> {
  return Promise.all(targets.map((target) => probe(target, fetchImpl)));
}
