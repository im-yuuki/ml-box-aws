"use client";

import { useCallback, useEffect, useState } from "react";
import { bffFetch } from "@/lib/bffFetch";
import { runtimeStateKey, type RuntimeStateKey } from "@/lib/artifacts";

export type ProjectSandbox = {
  name: string;
  state: string;
  url: string | null;
  // Instance type of the running server; null when stopped.
  profile?: string | null;
};

export type ProjectSandboxResponse = {
  projectId: string;
  canOperate: boolean;
  sandbox: ProjectSandbox | null;
  // The user's last started instance type, used as the default for the next start.
  preferredProfile?: string | null;
  // The instance types the Space can run. The BFF sends them with the sandbox, so a list of
  // Projects needs one request per Project instead of two.
  profiles?: SandboxProfileOption[];
};

export type SandboxAction = "start" | "stop";

export type SandboxProfileOption = {
  slug: string;
  label: string;
  description: string;
  kind: "cpu" | "gpu";
  cpuCores: number;
  ramGb: number;
  gpu: string | null;
  available: boolean;
};

export type SandboxErrorKey = "loadFailed" | "ownerNotReady" | "forbidden" | "startFailed" | "stopFailed" | "quotaExceeded" | "planRequired" | "alreadyRunning";

// How often the state of a starting sandbox is read again: every three seconds for five minutes.
// The Hub gives up on a sandbox that does not start, so polling longer does not help.
const MAX_STARTING_POLLS = 100;

/**
 * Loads and operates the notebook runtime of one Project. Shared by the
 * projects list (per-card control) and the project detail panel.
 */
export function useProjectSandbox(projectId: string) {
  const [data, setData] = useState<ProjectSandboxResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<SandboxErrorKey | null>(null);

  const base = `/api/bff/projects/${encodeURIComponent(projectId)}/sandbox`;

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const response = await bffFetch(base, { cache: "no-store" });
      if (!response.ok) {
        setError("loadFailed");
        return;
      }
      const body = await response.json() as ProjectSandboxResponse;
      setData(body);
      if (body.profiles) setProfiles(body.profiles);
      setError(null);
    } catch {
      setError("loadFailed");
    } finally {
      setLoading(false);
    }
  }, [base]);

  useEffect(() => {
    const task = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(task);
  }, [load]);

  const act = useCallback(async (action: SandboxAction, profile?: string) => {
    setBusy(true);
    setError(null);
    try {
      const response = action === "start" && profile
        ? await bffFetch(`${base}/start`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ profile }),
        })
        : await bffFetch(`${base}/${action}`, { method: "POST" });
      if (!response.ok) {
        const body = await response.json().catch(() => ({})) as { error?: string };
        if (body.error === "PROJECT_OWNER_NOT_READY") setError("ownerNotReady");
        else if (body.error === "SANDBOX_ALREADY_RUNNING") setError("alreadyRunning");
        else if (body.error === "QUOTA_EXCEEDED") setError("quotaExceeded");
        else if (body.error === "GPU_NOT_IN_PLAN") setError("planRequired");
        else if (response.status === 403) setError("forbidden");
        else setError(action === "start" ? "startFailed" : "stopFailed");
        return;
      }
      await load();
    } catch {
      setError(action === "start" ? "startFailed" : "stopFailed");
    } finally {
      setBusy(false);
    }
  }, [base, load]);

  const [profiles, setProfiles] = useState<SandboxProfileOption[]>([]);

  // The profiles arrive with the sandbox, so no second request per Project is needed. The separate
  // endpoint is only asked when the BFF did not send them (an older deployment).
  useEffect(() => {
    if (data?.profiles) return;
    let cancelled = false;
    const task = window.setTimeout(() => {
      bffFetch(`${base}/profiles`, { cache: "no-store" })
        .then((response) => (response.ok ? response.json() as Promise<{ profiles?: SandboxProfileOption[] }> : null))
        .then((body) => {
          if (!cancelled && body?.profiles) setProfiles(body.profiles);
        })
        .catch(() => undefined);
    }, 0);
    return () => {
      cancelled = true;
      window.clearTimeout(task);
    };
  }, [base, data?.profiles]);

  const stateKey: RuntimeStateKey = runtimeStateKey(data?.sandbox?.state);

  // A sandbox that is starting changes state on its own, so the panel has to keep asking. Without
  // this the chip stayed on "Starting" until the page was reloaded by hand. The polling stops after
  // a while: a sandbox that never leaves "starting" must not keep the browser busy forever.
  useEffect(() => {
    if (stateKey !== "starting") return;
    let attempts = 0;
    const timer = window.setInterval(() => {
      attempts += 1;
      if (attempts > MAX_STARTING_POLLS) {
        window.clearInterval(timer);
        return;
      }
      void load();
    }, 3000);
    return () => window.clearInterval(timer);
  }, [stateKey, load]);

  return {
    data,
    loading,
    busy,
    error,
    stateKey,
    canOperate: data?.canOperate ?? false,
    profiles,
    runningProfile: data?.sandbox?.profile ?? null,
    preferredProfile: data?.preferredProfile ?? null,
    act,
  };
}
