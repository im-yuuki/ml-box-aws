"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Alert, Button, Card, ProgressBar, Spinner, Table } from "@heroui/react";
import { RotateCcw } from "lucide-react";
import { useTranslations } from "next-intl";
import { bffFetch } from "@/lib/bffFetch";
import UsageChart from "@/components/UsageChart";

type Tracking = "not-tracked" | "allocated-footprint" | "not-available" | "disabled";

type Metric = { limit: number; unit: string; usage: number | null; tracking: Tracking };

type UsageServer = {
  name: string;
  state: "running" | "pending" | "stopped";
  url: string | null;
  lastActivity: string | null;
  cpuCoresAllocated: number | null;
  ramGbAllocated: number | null;
};

type HistorySample = {
  sampledAt: string;
  runningServers: number;
  cpuCoresAllocated: number | null;
  ramGbAllocated: number | null;
};

type UsageResponse = {
  generatedAt: string;
  history?: HistorySample[];
  historyAvailable?: boolean;
  quota: {
    cpuHours: Metric;
    ramGb: Metric;
    storageGb: Metric;
    gpuHours: Metric;
  };
  footprint: {
    runningServers: number;
    pendingServers: number;
    cpuCoresAllocated: number | null;
    ramGbAllocated: number | null;
    servers: UsageServer[];
  };
};

type Translator = ReturnType<typeof useTranslations<"usage">>;

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

function trackingLabel(tracking: Tracking, t: Translator): string {
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

/** Threshold colours: warning from 80%, critical from 100%. */
function levelFor(percent: number): "ok" | "warn" | "bad" {
  if (percent >= 100) return "bad";
  if (percent >= 80) return "warn";
  return "ok";
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

  const meters = useMemo(() => data ? [
    { key: "cpuHours", label: t("cpuHours"), metric: data.quota.cpuHours },
    { key: "ramGb", label: t("ram"), metric: data.quota.ramGb },
    { key: "storageGb", label: t("storage"), metric: data.quota.storageGb },
    { key: "gpuHours", label: t("gpuHours"), metric: data.quota.gpuHours },
  ] : [], [data, t]);

  const history = data?.history ?? [];

  if (loading) return <div className="flex items-center gap-2 text-sm" role="status"><Spinner size="sm" /><span>{t("loading")}</span></div>;
  if (error) return <div className="flex flex-col items-start gap-3"><Alert status="danger"><Alert.Content><Alert.Description>{error}</Alert.Description></Alert.Content></Alert><Button variant="secondary" onPress={() => void load()}><RotateCcw aria-hidden="true" size={16} />{t("retry")}</Button></div>;
  if (!data) return null;

  return (
    <div className="flex flex-col gap-10">
      <section aria-labelledby="quota-heading" className="flex flex-col gap-4">
        <div className="flex flex-wrap items-end justify-between gap-2">
          <div>
            <h2 id="quota-heading" className="text-lg font-semibold">{t("quotaHeading")}</h2>
          </div>
          <span className="workspace-meter-note">{t("lastUpdated", { when: formatDate(data.generatedAt) })}</span>
        </div>
        <Card className="p-5">
          {meters.map(({ key, label, metric }) => {
            const measured = metric.usage !== null && metric.limit > 0;
            const percent = measured ? Math.min(100, ((metric.usage as number) / metric.limit) * 100) : 0;
            const level = levelFor(measured ? ((metric.usage as number) / metric.limit) * 100 : 0);
            return (
              <div className="workspace-meter" key={key}>
                <div className="workspace-meter-head">
                  <span>{label}</span>
                  <span className="workspace-meter-value">
                    {measured
                      ? `${formatNumber(metric.usage)} / ${formatNumber(metric.limit)} ${metric.unit}`
                      : `— / ${formatNumber(metric.limit)} ${metric.unit}`}
                  </span>
                </div>
                <ProgressBar aria-label={label} value={percent} color={level === "bad" ? "danger" : level === "warn" ? "warning" : "accent"} size="sm">
                  <ProgressBar.Track>
                    <ProgressBar.Fill />
                  </ProgressBar.Track>
                </ProgressBar>
                {!measured ? <span className="workspace-meter-note">{trackingLabel(metric.tracking, t)}</span> : null}
              </div>
            );
          })}
        </Card>
        {data.quota.ramGb.usage !== null && data.quota.ramGb.limit > 0 && data.quota.ramGb.usage / data.quota.ramGb.limit >= 0.8 ? (
          <Alert status="warning"><Alert.Content><Alert.Description>{t("quotaWarningRam")}</Alert.Description></Alert.Content></Alert>
        ) : null}
      </section>

      <section aria-labelledby="footprint-heading" className="flex flex-col gap-4">
        <div>
          <h2 id="footprint-heading" className="text-lg font-semibold">{t("footprintHeading")}</h2>
        </div>
        <Card className="p-5">
          {data.footprint.runningServers === 0 && data.footprint.pendingServers === 0 ? (
            <p className="text-sm" style={{ color: "var(--muted)" }}>{t("noRunningServers")}</p>
          ) : (
            <dl className="grid gap-4 sm:grid-cols-4">
              <div><dt className="workspace-meter-note">{t("runningServers")}</dt><dd className="text-xl font-semibold">{data.footprint.runningServers}</dd></div>
              <div><dt className="workspace-meter-note">{t("pendingServers")}</dt><dd className="text-xl font-semibold">{data.footprint.pendingServers}</dd></div>
              <div><dt className="workspace-meter-note">{t("cpuAllocated")}</dt><dd className="text-xl font-semibold">{formatNumber(data.footprint.cpuCoresAllocated)} {t("unitCores")}</dd></div>
              <div><dt className="workspace-meter-note">{t("ramAllocated")}</dt><dd className="text-xl font-semibold">{formatNumber(data.footprint.ramGbAllocated)} {t("unitGb")}</dd></div>
            </dl>
          )}
          {data.footprint.servers.length === 0 ? null : (
            <ul className="mt-4 flex flex-col divide-y" style={{ borderColor: "var(--border)" }}>
              {data.footprint.servers.map((server) => (
                <li key={server.name} className="flex flex-wrap items-center justify-between gap-3 py-3">
                  <div className="flex flex-col">
                    <span className="text-sm font-medium">{server.name}</span>
                    <span className="workspace-meter-note">{server.lastActivity ? t("lastActivity", { when: formatDate(server.lastActivity) }) : t("lastActivityUnknown")}</span>
                  </div>
                  <span className="workspace-meter-value">{formatNumber(server.cpuCoresAllocated)} {t("unitCores")} · {formatNumber(server.ramGbAllocated)} {t("unitGb")}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </section>

      <section aria-labelledby="history-heading" className="flex flex-col gap-4">
        <div>
          <h2 id="history-heading" className="text-lg font-semibold">{t("historyHeading")}</h2>
          {!data.historyAvailable ? <p className="text-sm" style={{ color: "var(--muted)" }}>{t("historyUnavailable")}</p> : null}
        </div>
        {data.historyAvailable ? (
          <>
            <Card>
              <Card.Content className="workspace-charts">
                <UsageChart
                  title={t("ramAllocated")}
                  unit={t("unitGb")}
                  points={history.map((sample) => ({ time: sample.sampledAt, value: sample.ramGbAllocated }))}
                  emptyLabel={t("historyEmpty")}
                />
                <UsageChart
                  title={t("cpuAllocated")}
                  unit={t("unitCores")}
                  points={history.map((sample) => ({ time: sample.sampledAt, value: sample.cpuCoresAllocated }))}
                  emptyLabel={t("historyEmpty")}
                />
              </Card.Content>
            </Card>
            {history.length === 0 ? (
              <p className="text-sm" style={{ color: "var(--muted)" }}>{t("historyEmpty")}</p>
            ) : (
              <Table aria-label={t("historyHeading")}>
                <Table.ScrollContainer>
                  <Table.Content>
                    <Table.Header>
                      <Table.Column isRowHeader>{t("historyTime")}</Table.Column>
                      <Table.Column>{t("runningServers")}</Table.Column>
                      <Table.Column>{t("cpuAllocated")}</Table.Column>
                      <Table.Column>{t("ramAllocated")}</Table.Column>
                    </Table.Header>
                    <Table.Body>
                      {[...history].reverse().map((sample) => (
                        <Table.Row key={sample.sampledAt} id={sample.sampledAt}>
                          <Table.Cell>{formatDate(sample.sampledAt)}</Table.Cell>
                          <Table.Cell>{sample.runningServers}</Table.Cell>
                          <Table.Cell>{formatNumber(sample.cpuCoresAllocated)} {t("unitCores")}</Table.Cell>
                          <Table.Cell>{formatNumber(sample.ramGbAllocated)} {t("unitGb")}</Table.Cell>
                        </Table.Row>
                      ))}
                    </Table.Body>
                  </Table.Content>
                </Table.ScrollContainer>
              </Table>
            )}
          </>
        ) : null}
      </section>
    </div>
  );
}
