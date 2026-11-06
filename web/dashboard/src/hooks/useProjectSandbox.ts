"use client";

import { useCallback, useEffect, useState } from "react";
import { bffFetch } from "@/lib/bffFetch";
import { runtimeStateKey, type RuntimeStateKey } from "@/lib/artifacts";

export type ProjectSandbox = { name: string; state: string; url: string | null };

export type ProjectSandboxResponse = {
  projectId: string;
  canOperate: boolean;
  sandbox: ProjectSandbox | null;
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

export type SandboxErrorKey = "loadFailed" | "ownerNotReady" | "forbidden" | "startFailed" | "stopFailed";

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
      setData(await response.json() as ProjectSandboxResponse);
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

  useEffect(() => {
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
  }, [base]);

  const stateKey: RuntimeStateKey = runtimeStateKey(data?.sandbox?.state);

  return {
    data,
    loading,
    busy,
    error,
    stateKey,
    canOperate: data?.canOperate ?? false,
    profiles,
    act,
  };
}
