"use client";

import { useCallback, useEffect, useState } from "react";
import { Button, Card } from "@heroui/react";
import { useTranslations } from "next-intl";
import { bffFetch } from "@/lib/bffFetch";
import { runtimeStateKey } from "@/lib/artifacts";

type SandboxResponse = {
  projectId: string;
  canOperate: boolean;
  sandbox: { name: string; state: string; url: string | null } | null;
};

export default function ProjectRuntimePanel({ projectId }: { projectId: string }) {
  const t = useTranslations("projectRuntime");
  const [data, setData] = useState<SandboxResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [usage, setUsage] = useState<{ hours: number; sessions: number; openSession: boolean; windowDays: number } | null>(null);

  const base = `/api/bff/projects/${encodeURIComponent(projectId)}/sandbox`;

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const response = await bffFetch(base, { cache: "no-store" });
      if (!response.ok) {
        setError(t("loadFailed"));
        return;
      }
      setData(await response.json() as SandboxResponse);
      const usageResponse = await bffFetch(`/api/bff/projects/${encodeURIComponent(projectId)}/usage`, { cache: "no-store" });
      if (usageResponse.ok) {
        const body = await usageResponse.json() as { usage?: { hours: number; sessions: number; openSession: boolean; windowDays: number } };
        setUsage(body.usage ?? null);
      }
      setError(null);
    } catch {
      setError(t("loadFailed"));
    } finally {
      setLoading(false);
    }
  }, [base, t]);

  useEffect(() => {
    const task = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(task);
  }, [load]);

  const act = async (action: "start" | "stop") => {
    setBusy(true);
    setError(null);
    try {
      const response = await bffFetch(`${base}/${action}`, { method: "POST" });
      if (!response.ok) {
        const body = await response.json().catch(() => ({})) as { error?: string };
        if (body.error === "PROJECT_OWNER_NOT_READY") setError(t("ownerNotReady"));
        else if (response.status === 403) setError(t("forbidden"));
        else setError(action === "start" ? t("startFailed") : t("stopFailed"));
        return;
      }
      await load();
    } catch {
      setError(action === "start" ? t("startFailed") : t("stopFailed"));
    } finally {
      setBusy(false);
    }
  };

  const stateKey = runtimeStateKey(data?.sandbox?.state);
  const canOperate = data?.canOperate ?? false;

  return (
    <Card className="workspace-detail-section">
      <span className="workspace-section-index">{t("section")}</span>
      <h2>{t("title")}</h2>
      <p>{t("body")}</p>
      {loading ? <p className="workspace-muted-copy" role="status">{t("loading")}</p> : null}
      {data ? <p className="workspace-status workspace-status-muted" aria-live="polite">{t(`state.${stateKey}`)}</p> : null}
      {error ? <p className="workspace-form-error" role="alert">{error}</p> : null}
      <div className="flex gap-2">
        <Button variant="primary" size="sm" isDisabled={busy || loading || !canOperate || stateKey === "running" || stateKey === "starting"} onPress={() => void act("start")}>
          {t("start")}
        </Button>
        <Button variant="secondary" size="sm" isDisabled={busy || loading || !canOperate || stateKey !== "running"} onPress={() => void act("stop")}>
          {t("stop")}
        </Button>
        {data?.sandbox?.url ? <a className="workspace-count-label" href={data.sandbox.url} target="_blank" rel="noreferrer">{t("open")}</a> : null}
      </div>
      {data && !canOperate ? <p className="workspace-muted-copy">{t("readOnly")}</p> : null}
      {usage ? <p className="workspace-muted-copy">{t("usage", { hours: usage.hours, days: usage.windowDays })}</p> : null}
      {usage ? <p className="workspace-muted-copy">{t("usageNote")}</p> : null}
    </Card>
  );
}
