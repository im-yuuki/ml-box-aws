"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Button, ProgressBar } from "@heroui/react";
import { useTranslations } from "next-intl";
import { bffFetch } from "@/lib/bffFetch";

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
  history?: Array<{ sampledAt: string; runningServers: number; cpuCoresAllocated: number | null; ramGbAllocated: number | null }>;
  historyAvailable?: boolean;
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
      const response = await bffFetch("/api/bff/usage", { cache: "no-store" });
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
    <div className="page">
      <section className="usage-section" aria-labelledby="quota-heading">
        <div className="section-head">
          <div>
            <h2 id="quota-heading" className="panel-title">{t("quotaHeading")}</h2>
            <p className="muted">{t("quotaDescription")}</p>
          </div>
          <span className="muted small">{t("lastUpdated", { when: formatDate(data.generatedAt) })}</span>
        </div>
        <div className="stat-grid">
          {cards.map((card) => {
            const usage = card.metric.usage;
            const progress = usage === null || card.metric.limit <= 0 ? undefined : Math.min(100, (usage / card.metric.limit) * 100);
            return (
              <article key={card.key} className="stat">
                <div className="stat-top">
                  <span className="muted small">{card.label}</span>
                  <span className="pill">{trackingLabel(card.metric.tracking, t)}</span>
                </div>
                <span className="stat-value">{card.detail}</span>
                {progress === undefined ? (
                  <p className="muted small">{trackingLabel(card.metric.tracking, t)}</p>
                ) : (
                  <div className="stat-progress">
                    <div className="stat-progress-labels muted small"><span>{formatNumber(usage)} {card.metric.unit}</span><span>{formatNumber(card.metric.limit)} {card.metric.unit}</span></div>
                    <ProgressBar value={progress} aria-label={card.label} color={progress > 80 ? "warning" : "accent"} />
                  </div>
                )}
              </article>
            );
          })}
        </div>
        {data.quota.ramGb.usage !== null && data.quota.ramGb.limit > 0 && data.quota.ramGb.usage / data.quota.ramGb.limit >= 0.8 ? (
          <p className="form-warning" role="status">{t("quotaWarningRam")}</p>
        ) : null}
      </section>

      <section className="usage-section" aria-labelledby="footprint-heading">
        <div className="section-head">
          <div>
            <h2 id="footprint-heading" className="panel-title">{t("footprintHeading")}</h2>
            <p className="muted">{t("footprintDescription")}</p>
          </div>
        </div>
        <div className="stat-grid stat-grid-4">
          <article className="stat"><span className="muted small">{t("runningServers")}</span><span className="stat-value">{data.footprint.runningServers}</span></article>
          <article className="stat"><span className="muted small">{t("pendingServers")}</span><span className="stat-value">{data.footprint.pendingServers}</span></article>
          <article className="stat"><span className="muted small">{t("cpuAllocated")}</span><span className="stat-value">{formatNumber(data.footprint.cpuCoresAllocated)} <small>{t("unitCores")}</small></span></article>
          <article className="stat"><span className="muted small">{t("ramAllocated")}</span><span className="stat-value">{formatNumber(data.footprint.ramGbAllocated)} <small>{t("unitGb")}</small></span></article>
        </div>
        {data.footprint.servers.length === 0 ? (
          <div className="empty"><p>{t("noRunningServers")}</p></div>
        ) : (
          <ul className="artifact-list">
            {data.footprint.servers.map((server) => (
              <li key={server.name} className="artifact-row">
                <div className="server-meta">
                  <span className="artifact-name">{server.name}</span>
                  <span className="muted small">{server.lastActivity ? t("lastActivity", { when: formatDate(server.lastActivity) }) : t("lastActivityUnknown")}</span>
                </div>
                <span className="muted small">{formatNumber(server.cpuCoresAllocated)} {t("unitCores")}</span>
                <span className="muted small">{formatNumber(server.ramGbAllocated)} {t("unitGb")}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="usage-section" aria-labelledby="history-heading">
        <div className="section-head">
          <div>
            <h2 id="history-heading" className="panel-title">{t("historyHeading")}</h2>
            <p className="muted">{data.historyAvailable ? t("historyDescription") : t("historyUnavailable")}</p>
          </div>
        </div>
        {data.historyAvailable && (data.history?.length ?? 0) > 0 ? (
          <ul className="artifact-list">
            {data.history?.map((sample) => (
              <li key={sample.sampledAt} className="artifact-row">
                <span className="artifact-name">{formatDate(sample.sampledAt)}</span>
                <span className="muted small">{t("historySample", { servers: sample.runningServers, cpu: formatNumber(sample.cpuCoresAllocated), ram: formatNumber(sample.ramGbAllocated) })}</span>
              </li>
            ))}
          </ul>
        ) : data.historyAvailable ? <div className="empty"><p>{t("historyEmpty")}</p></div> : null}
      </section>
    </div>
  );
}
