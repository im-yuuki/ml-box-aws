import { mapHubServerState, mapHubStartResponse, resolveHubLifecycle, type HubLifecycleState, type HubRequestResponse, type HubServerLike } from "./hub.js";

export function shouldUseHubActivationFallback(userExists: boolean, error: unknown): boolean {
  if (userExists || typeof error !== "object" || error === null || !("status" in error)) return false;
  return Number((error as { status?: unknown }).status) === 404;
}

export function shouldStartHubSandbox(server: HubServerLike | null): boolean {
  const state = mapHubServerState(server);
  return state === "stopped" || state === "failed" || server === null;
}

export type HubFetchInit = {
  method: string;
  headers: Record<string, string>;
  body?: string;
  signal?: AbortSignal;
};

export type HubFetchResponse = {
  status: number;
  ok: boolean;
  text: () => Promise<string>;
};

export type HubFetch = (url: string, init: HubFetchInit) => Promise<HubFetchResponse>;

export type HubResponseOptions = {
  hubUrl: string;
  hubApiToken: string;
  method: string;
  path: string;
  body?: unknown;
  fetchImpl?: HubFetch;
};

export async function requestHubResponse<T>({ hubUrl, hubApiToken, method, path, body, fetchImpl = fetch as unknown as HubFetch }: HubResponseOptions): Promise<HubRequestResponse<T>> {
  const response = await fetchImpl(`${hubUrl}${path}`, {
    method,
    headers: {
      Authorization: `token ${hubApiToken}`,
      Accept: "application/json",
      ...(body === undefined ? {} : { "content-type": "application/json" }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(15_000),
  });
  const text = await response.text();
  let parsed: unknown = null;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    parsed = { message: text };
  }
  if (!response.ok) {
    const error = new Error(`JupyterHub returned ${response.status}`) as Error & { status?: number };
    error.status = response.status;
    throw error;
  }
  return { status: response.status, body: parsed as T | null };
}

export type LifecycleAudit = (action: string, metadata?: Record<string, unknown>) => Promise<unknown>;

export type StartLifecycleOptions = {
  start: () => Promise<HubRequestResponse<HubServerLike>>;
  read?: () => Promise<HubServerLike>;
  audit?: LifecycleAudit;
  maxAttempts?: number;
  timeoutMs?: number;
  backoffMs?: number;
  maxBackoffMs?: number;
  now?: () => number;
  sleep?: (milliseconds: number) => Promise<void>;
};

export type StartLifecycleResult = {
  state: HubLifecycleState;
  status: number;
  body: HubServerLike | null;
};

async function bestEffortAudit(audit: LifecycleAudit | undefined, action: string, metadata?: Record<string, unknown>): Promise<void> {
  if (!audit) return;
  try {
    await audit(action, metadata);
  } catch {
    // Lifecycle auditing must not make a Hub operation fail.
  }
}

export async function resolveStartLifecycle(options: StartLifecycleOptions): Promise<StartLifecycleResult> {
  await bestEffortAudit(options.audit, "sandbox.start_requested");
  const started = await options.start();
  const initial = mapHubStartResponse(started);
  if (initial === "failed") {
    await bestEffortAudit(options.audit, "sandbox.failed", { status: started.status });
    return { state: "failed", status: started.status, body: started.body };
  }
  if (initial === "ready") {
    await bestEffortAudit(options.audit, "sandbox.ready", { status: started.status });
    return { state: "ready", status: started.status, body: started.body };
  }

  await bestEffortAudit(options.audit, "sandbox.starting", { status: started.status });
  if (!options.read) return { state: "starting", status: started.status, body: started.body };

  const lifecycle = await resolveHubLifecycle({
    read: options.read,
    maxAttempts: options.maxAttempts ?? 3,
    timeoutMs: options.timeoutMs ?? 15_000,
    backoffMs: options.backoffMs ?? 250,
    maxBackoffMs: options.maxBackoffMs ?? 2_000,
    now: options.now,
    sleep: options.sleep,
  });
  if (lifecycle === "ready") await bestEffortAudit(options.audit, "sandbox.ready", { status: started.status });
  if (lifecycle === "failed") await bestEffortAudit(options.audit, "sandbox.failed", { status: started.status });
  return { state: lifecycle, status: started.status, body: started.body };
}
