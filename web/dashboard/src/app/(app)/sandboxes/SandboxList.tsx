"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Button, Card, Surface } from "@heroui/react";
import { useTranslations } from "next-intl";
import { bffFetch } from "@/lib/bffFetch";
import HubActivationCard from "./HubActivationCard";

type Sandbox = {
  name: string;
  state: "running" | "pending" | "stopped" | "failed";
  lastActivity: string | null;
  url: string | null;
};

type HubStatus = {
  userExists: boolean;
  activationRequired: boolean;
  activationUrl: string;
};

type ErrorResult = { key: string; hub?: HubStatus };

async function errorKey(response: Response): Promise<ErrorResult> {
  const body = await response.json().catch(() => ({})) as { error?: string; activationUrl?: string };
  if (body.error === "HUB_USER_UNKNOWN" && body.activationUrl) {
    return { key: "hubUserUnknown", hub: { userExists: false, activationRequired: true, activationUrl: body.activationUrl } };
  }
  return { key: ({ HUB_TIMEOUT: "hubTimeout", HUB_UNAVAILABLE: "hubUnavailable", QUOTA_EXCEEDED: "quotaExceeded", FORBIDDEN: "forbidden", BAD_REQUEST: "badRequest", SANDBOX_CONFLICT: "conflict", SANDBOX_NOT_FOUND: "notFound" } as Record<string, string>)[body.error ?? ""] ?? "actionFailed" };
}

export default function SandboxList() {
  const t = useTranslations("sandboxes");
  const tCommon = useTranslations("common");
  const searchParams = useSearchParams();
  const enforcementDegraded = searchParams.get("enforcement") === "degraded";
  const [sandboxes, setSandboxes] = useState<Sandbox[]>([]);
  const [hub, setHub] = useState<HubStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [pendingName, setPendingName] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    setHub(null);
    try {
      const response = await bffFetch("/api/bff/sandboxes", { cache: "no-store" });
      if (!response.ok) {
        const failure = await errorKey(response);
        if (failure.hub) setHub(failure.hub);
        throw new Error(failure.key);
      }
      const body = (await response.json()) as { sandboxes?: Sandbox[]; hub?: HubStatus };
      setHub(body.hub ?? null);
      setSandboxes(body.sandboxes ?? []);
    } catch (reason) {
      setError(reason instanceof Error ? t(`errors.${reason.message}`) : t("errors.loadFailed"));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    const task = window.setTimeout(() => { void load(); }, 0);
    return () => window.clearTimeout(task);
  }, [load]);

  const changeState = async (sandbox: Sandbox) => {
    setPendingName(sandbox.name);
    setError(null);
    try {
      const response = await bffFetch(
        sandbox.state === "running" ? `/api/bff/sandboxes/${encodeURIComponent(sandbox.name)}` : `/api/bff/sandboxes/${encodeURIComponent(sandbox.name)}/start`,
        { method: sandbox.state === "running" ? "DELETE" : "POST", headers: { "content-type": "application/json" }, body: sandbox.state === "running" ? undefined : "{}" },
      );
      if (!response.ok) {
        const failure = await errorKey(response);
        if (failure.hub) setHub(failure.hub);
        throw new Error(failure.key);
      }
      await load();
    } catch (reason) {
      setError(reason instanceof Error ? t(`errors.${reason.message}`) : t("errors.actionFailed"));
    } finally {
      setPendingName(null);
    }
  };

  if (loading) return <p className="text-sm" style={{ color: "var(--muted)" }}>{t("loading")}</p>;
  if (hub?.activationRequired) return <div className="flex flex-col gap-3"><HubActivationCard activationUrl={hub.activationUrl} onCheck={() => void load()} />{error ? <p className="text-sm" style={{ color: "var(--danger)" }} role="alert">{error}</p> : null}</div>;
  if (error && sandboxes.length === 0) return <div className="flex flex-col gap-3"><p className="text-sm" style={{ color: "var(--danger)" }} role="alert">{error}</p><Button variant="secondary" onPress={() => void load()}>{t("retry")}</Button></div>;
  if (sandboxes.length === 0) return <div className="flex flex-col gap-3">{enforcementDegraded ? <p className="text-sm" role="status" style={{ color: "var(--warning)" }}>{t("enforcementDegraded")}</p> : null}<p className="text-sm" style={{ color: "var(--muted)" }}>{t("empty")}</p></div>;

  return (
    <div className="flex flex-col gap-4">
      {enforcementDegraded ? <p className="text-sm" role="status" style={{ color: "var(--warning)" }}>{t("enforcementDegraded")}</p> : null}
      {error ? <p className="text-sm" style={{ color: "var(--danger)" }} role="alert">{error}</p> : null}
      <div className="grid gap-4 sm:grid-cols-2">
        {sandboxes.map((sandbox) => {
          const running = sandbox.state === "running";
          const failed = sandbox.state === "failed";
          const pending = pendingName === sandbox.name;
          return (
            <Card key={sandbox.name} className="p-5">
              <div className="flex items-start justify-between">
                <div className="flex flex-col gap-1">
                  <span className="text-sm" style={{ color: "var(--muted)" }}>{t("profileCpu")}</span>
                  <span className="text-lg font-medium">{sandbox.name}</span>
                  {sandbox.lastActivity ? <span className="text-xs" style={{ color: "var(--muted)" }}>{t("lastActivity", { when: sandbox.lastActivity })}</span> : null}
                </div>
                <span className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs" style={{ background: running ? "color-mix(in srgb, var(--success) 18%, transparent)" : failed ? "color-mix(in srgb, var(--danger) 18%, transparent)" : "color-mix(in srgb, var(--default) 70%, transparent)", color: running ? "var(--success)" : failed ? "var(--danger)" : "var(--muted)" }}>
                  {sandbox.state === "pending" ? t("statePending") : running ? t("stateRunning") : failed ? t("stateFailed") : t("stateStopped")}
                </span>
              </div>
              <Surface className="mt-4 flex gap-2 p-3">
                {running && sandbox.url ? <Link href={sandbox.url}><Button variant="primary" size="sm">{tCommon("openLab")}</Button></Link> : <Button variant="primary" size="sm" onPress={() => void changeState(sandbox)} isPending={pending} isDisabled={pending || sandbox.state === "pending"}>{failed ? t("restart") : tCommon("start")}</Button>}
                {running ? <Button size="sm" variant="danger" onPress={() => void changeState(sandbox)} isPending={pending} isDisabled={pending}>{tCommon("stop")}</Button> : null}
                <Button size="sm" variant="secondary" isDisabled>{tCommon("rename")}</Button>
              </Surface>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
