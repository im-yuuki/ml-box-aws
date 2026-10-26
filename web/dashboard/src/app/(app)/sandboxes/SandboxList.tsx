"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Button, Card, Surface } from "@heroui/react";
import { useTranslations } from "next-intl";

type Sandbox = {
  name: string;
  state: "running" | "pending" | "stopped";
  lastActivity: string | null;
  url: string | null;
};

function messageFrom(response: Response, fallback: string): Promise<string> {
  return response.json().then((body: { message?: string }) => body.message ?? fallback).catch(() => fallback);
}

export default function SandboxList() {
  const t = useTranslations("sandboxes");
  const tCommon = useTranslations("common");
  const [sandboxes, setSandboxes] = useState<Sandbox[]>([]);
  const [loading, setLoading] = useState(true);
  const [pendingName, setPendingName] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch("/api/bff/sandboxes", { cache: "no-store" });
      if (!response.ok) throw new Error(await messageFrom(response, t("loadFailed")));
      const body = (await response.json()) as { sandboxes?: Sandbox[] };
      setSandboxes(body.sandboxes ?? []);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : t("loadFailed"));
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
      const response = await fetch(
        sandbox.state === "running" ? `/api/bff/sandboxes/${encodeURIComponent(sandbox.name)}` : `/api/bff/sandboxes/${encodeURIComponent(sandbox.name)}/start`,
        { method: sandbox.state === "running" ? "DELETE" : "POST", headers: { "content-type": "application/json" }, body: sandbox.state === "running" ? undefined : "{}" },
      );
      if (!response.ok) throw new Error(await messageFrom(response, t("actionFailed")));
      await load();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : t("actionFailed"));
    } finally {
      setPendingName(null);
    }
  };

  if (loading) return <p className="text-sm" style={{ color: "var(--muted)" }}>{t("loading")}</p>;
  if (error && sandboxes.length === 0) return <div className="flex flex-col gap-3"><p className="text-sm" style={{ color: "var(--danger)" }} role="alert">{error}</p><Button variant="secondary" onPress={() => void load()}>{t("retry")}</Button></div>;
  if (sandboxes.length === 0) return <p className="text-sm" style={{ color: "var(--muted)" }}>{t("empty")}</p>;

  return (
    <div className="flex flex-col gap-4">
      {error ? <p className="text-sm" style={{ color: "var(--danger)" }} role="alert">{error}</p> : null}
      <div className="grid gap-4 sm:grid-cols-2">
        {sandboxes.map((sandbox) => {
          const running = sandbox.state === "running";
          const pending = pendingName === sandbox.name;
          return (
            <Card key={sandbox.name} className="p-5">
              <div className="flex items-start justify-between">
                <div className="flex flex-col gap-1">
                  <span className="text-sm" style={{ color: "var(--muted)" }}>{t("profileCpu")}</span>
                  <span className="text-lg font-medium">{sandbox.name}</span>
                  {sandbox.lastActivity ? <span className="text-xs" style={{ color: "var(--muted)" }}>{t("lastActivity", { when: sandbox.lastActivity })}</span> : null}
                </div>
                <span className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs" style={{ background: running ? "color-mix(in srgb, var(--success) 18%, transparent)" : "color-mix(in srgb, var(--default) 70%, transparent)", color: running ? "var(--success)" : "var(--muted)" }}>
                  {sandbox.state === "pending" ? t("statePending") : running ? t("stateRunning") : t("stateStopped")}
                </span>
              </div>
              <Surface className="mt-4 flex gap-2 p-3">
                {running && sandbox.url ? <Link href={sandbox.url}><Button variant="primary" size="sm">{tCommon("openLab")}</Button></Link> : <Button variant="primary" size="sm" onPress={() => void changeState(sandbox)} isPending={pending} isDisabled={pending || sandbox.state === "pending"}>{tCommon("start")}</Button>}
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
