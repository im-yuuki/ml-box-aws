"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Button, Card, ProgressBar, Surface } from "@heroui/react";
import { useTranslations } from "next-intl";

type Tracking = "not-tracked" | "allocated-footprint" | "not-available" | "disabled";

type UsageServer = {
  name: string;
  state: "running" | "pending" | "stopped";
  url: string | null;
  lastActivity: string | null;
  cpuCoresAllocated: number | null;
  ramGbAllocated: number | null;
};

type UsageResponse = {
  generatedAt: string;
  quota: {
    cpuHours: { limit: number; unit: string; usage: number | null; tracking: Tracking };
    ramGb: { limit: number; unit: string; usage: number | null; tracking: Tracking };
    storageGb: { limit: number; unit: string; usage: number | null; tracking: Tracking };
    gpuHours: { limit: number; unit: string; usage: number | null; tracking: Tracking };
  };
  footprint: {
    runningServers: number;
    pendingServers: number;
    cpuCoresAllocated: number | null;
    ramGbAllocated: number | null;
    servers: UsageServer[];
  };
};

function messageFrom(response: Response, fallback: string): Promise<string> {
  return response.json().then((body: { message?: string }) => body.message ?? fallback).catch(() => fallback);
}

function formatNumber(value: number | null, maximumFractionDigits = 1): string {
  return value === null ? "—" : new Intl.NumberFormat(undefined, { maximumFractionDigits }).format(value);
}

function formatDate(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.valueOf()) ? value : new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(date);
}

function trackingLabel(tracking: Tracking, t: ReturnType<typeof useTranslations<"usage">>): string {
  switch (tracking) {
    case "allocated-footprint":
      return t("allocatedFootprint");
    case "not-available":
      return t("notAvailable");
    case "disabled":
      return t("gpuDisabled");
    default:
      return t("notTracked");
  }
}

export default function UsagePanel() {
  const t = useTranslations("usage");
  const [data, setData] = useState<UsageResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch("/api/bff/usage", { cache: "no-store" });
      if (!response.ok) throw new Error(await messageFrom(response, t("loadFailed")));
      setData((await response.json()) as UsageResponse);
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

  const cards = useMemo(() => data ? [
    { key: "cpuHours", label: t("cpuHours"), metric: data.quota.cpuHours, detail: `${formatNumber(data.quota.cpuHours.limit)} ${t("unitHours")}` },
    { key: "ramGb", label: t("ram"), metric: data.quota.ramGb, detail: `${formatNumber(data.quota.ramGb.limit)} ${t("unitGb")}` },
    { key: "storageGb", label: t("storage"), metric: data.quota.storageGb, detail: `${formatNumber(data.quota.storageGb.limit)} ${t("unitGb")}` },
    { key: "gpuHours", label: t("gpuHours"), metric: data.quota.gpuHours, detail: `${formatNumber(data.quota.gpuHours.limit)} ${t("unitHours")}` },
  ] : [], [data, t]);

  if (loading) return <p className="text-sm" style={{ color: "var(--muted)" }}>{t("loading")}</p>;
  if (error) return <div className="flex flex-col gap-3"><p className="text-sm" style={{ color: "var(--danger)" }} role="alert">{error}</p><Button variant="secondary" onPress={() => void load()}>{t("retry")}</Button></div>;
  if (!data) return null;

  return (
    <div className="flex flex-col gap-8">
      <section aria-labelledby="quota-heading" className="flex flex-col gap-3">
        <div className="flex items-end justify-between gap-4">
          <div>
            <h2 id="quota-heading" className="text-lg font-medium">{t("quotaHeading")}</h2>
            <p className="text-sm" style={{ color: "var(--muted)" }}>{t("quotaDescription")}</p>
          </div>
          <span className="text-xs" style={{ color: "var(--muted)" }}>{t("lastUpdated", { when: formatDate(data.generatedAt) })}</span>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          {cards.map((card) => {
            const usage = card.metric.usage;
            const progress = usage === null || card.metric.limit <= 0 ? undefined : Math.min(100, (usage / card.metric.limit) * 100);
            return (
              <Card key={card.key} className="flex flex-col gap-4 p-5">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex flex-col gap-1">
                    <span className="text-sm" style={{ color: "var(--muted)" }}>{card.label}</span>
                    <span className="text-xl font-semibold">{card.detail}</span>
                  </div>
                  <span className="rounded-full px-2 py-1 text-xs" style={{ background: "color-mix(in srgb, var(--default) 70%, transparent)", color: "var(--muted)" }}>
                    {trackingLabel(card.metric.tracking, t)}
                  </span>
                </div>
                {progress === undefined ? (
                  <p className="text-sm" style={{ color: "var(--muted)" }}>{trackingLabel(card.metric.tracking, t)}</p>
                ) : (
                  <div className="flex flex-col gap-2">
                    <div className="flex justify-between text-sm"><span>{formatNumber(usage)} {card.metric.unit}</span><span>{formatNumber(card.metric.limit)} {card.metric.unit}</span></div>
                    <ProgressBar value={progress} aria-label={card.label} color={progress > 80 ? "warning" : "accent"} />
                  </div>
                )}
              </Card>
            );
          })}
        </div>
      </section>

      <section aria-labelledby="footprint-heading" className="flex flex-col gap-3">
        <div>
          <h2 id="footprint-heading" className="text-lg font-medium">{t("footprintHeading")}</h2>
          <p className="text-sm" style={{ color: "var(--muted)" }}>{t("footprintDescription")}</p>
        </div>
        <div className="grid gap-4 sm:grid-cols-4">
          <Surface className="flex flex-col gap-1 p-4"><span className="text-sm" style={{ color: "var(--muted)" }}>{t("runningServers")}</span><strong className="text-2xl">{data.footprint.runningServers}</strong></Surface>
          <Surface className="flex flex-col gap-1 p-4"><span className="text-sm" style={{ color: "var(--muted)" }}>{t("pendingServers")}</span><strong className="text-2xl">{data.footprint.pendingServers}</strong></Surface>
          <Surface className="flex flex-col gap-1 p-4"><span className="text-sm" style={{ color: "var(--muted)" }}>{t("cpuAllocated")}</span><strong className="text-2xl">{formatNumber(data.footprint.cpuCoresAllocated)} {t("unitCores")}</strong></Surface>
          <Surface className="flex flex-col gap-1 p-4"><span className="text-sm" style={{ color: "var(--muted)" }}>{t("ramAllocated")}</span><strong className="text-2xl">{formatNumber(data.footprint.ramGbAllocated)} {t("unitGb")}</strong></Surface>
        </div>
        {data.footprint.servers.length === 0 ? (
          <Card className="p-5"><p className="text-sm" style={{ color: "var(--muted)" }}>{t("noRunningServers")}</p></Card>
        ) : (
          <div className="flex flex-col gap-2">
            {data.footprint.servers.map((server) => (
              <Card key={server.name} className="flex flex-wrap items-center justify-between gap-3 p-4">
                <div className="flex flex-col gap-1"><strong>{server.name}</strong><span className="text-sm" style={{ color: "var(--muted)" }}>{server.lastActivity ? t("lastActivity", { when: formatDate(server.lastActivity) }) : t("lastActivityUnknown")}</span></div>
                <div className="flex items-center gap-4 text-sm" style={{ color: "var(--muted)" }}><span>{formatNumber(server.cpuCoresAllocated)} {t("unitCores")}</span><span>{formatNumber(server.ramGbAllocated)} {t("unitGb")}</span></div>
              </Card>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
