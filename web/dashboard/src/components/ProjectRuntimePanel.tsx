"use client";

import { useCallback, useEffect, useState } from "react";
import { Button } from "@heroui/react";
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

  // Opens the notebook through a one-time handoff so the user never has to sign in to the Hub.
  const openNotebook = async () => {
    if (!data?.sandbox?.url) return;
    setBusy(true);
    setError(null);
    try {
      const path = new URL(data.sandbox.url).pathname;
      const response = await bffFetch("/api/bff/hub/handoff", { method: "POST", body: JSON.stringify({ path }) });
      if (!response.ok) {
        setError(t("openFailed"));
        return;
      }
      const body = await response.json() as { url?: string };
      if (!body.url) {
        setError(t("openFailed"));
        return;
      }
      window.location.href = body.url;
    } catch {
      setError(t("openFailed"));
    } finally {
      setBusy(false);
    }
  };

  const stateKey = runtimeStateKey(data?.sandbox?.state);
  const canOperate = data?.canOperate ?? false;

  return (
    <section className="panel runtime">
      <div className="runtime-head">
        <h2 className="panel-title">{t("title")}</h2>
        {data ? <span className={`status-dot status-${stateKey}`} aria-live="polite">{t(`state.${stateKey}`)}</span> : null}
      </div>
      <p className="muted">{t("body")}</p>
      {loading ? <p className="muted" role="status">{t("loading")}</p> : null}
      {error ? <p className="form-error" role="alert">{error}</p> : null}
      <div className="runtime-actions">
        <Button variant="primary" isDisabled={busy || loading || !canOperate || stateKey === "running" || stateKey === "starting"} onPress={() => void act("start")}>
          {t("start")}
        </Button>
        <Button variant="secondary" isDisabled={busy || loading || !canOperate || stateKey !== "running"} onPress={() => void act("stop")}>
          {t("stop")}
        </Button>
        {data?.sandbox?.url ? <Button variant="tertiary" isDisabled={busy || loading} onPress={() => void openNotebook()}>{t("open")}</Button> : null}
      </div>
      {data && !canOperate ? <p className="muted">{t("readOnly")}</p> : null}
      {usage ? <p className="muted">{t("usage", { hours: usage.hours, days: usage.windowDays })}</p> : null}
      {usage ? <p className="muted small">{t("usageNote")}</p> : null}
    </section>
  );
}
