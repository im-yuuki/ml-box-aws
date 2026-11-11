"use client";

import { useCallback, useEffect, useState } from "react";
import { Button, Card, ProgressBar, Spinner } from "@heroui/react";
import { RotateCcw } from "lucide-react";
import { useTranslations } from "next-intl";
import { bffFetch } from "@/lib/bffFetch";
import FeedbackAlert from "@/components/FeedbackAlert";
import { useActiveSpace } from "@/hooks/useActiveSpace";
import ResourceHistory from "@/components/ResourceHistory";
import CreditSessionList from "@/components/CreditSessionList";
import { formatStorage, shareOfSpaceStorage } from "@/lib/storage";

type UsageResponse = {
  generatedAt: string;
  credits?: { planId: string; limit: number | null; used: number };
  concurrentSandboxes?: { limit: number | null; running: number };
  storageByProject?: Array<{ projectId: string; name: string; storageGb: number }>;
  creditSessions?: Array<{ id: string; projectName: string; startedAt: string; endedAt: string | null; hours: number; credits: number }>;
  resourceHistory?: {
    days: number;
    credits: Array<{ date: string; credits: number }>;
    storage: Array<{ date: string; storageGb: number }>;
  };
  quota: {
    storageGb: { limit: number; unit: "GB"; usage: number | null; tracking: string };
  };
};

function formatNumber(value: number | null, maximumFractionDigits = 1): string {
  return value === null
    ? "—"
    : new Intl.NumberFormat(undefined, { maximumFractionDigits }).format(value);
}

function formatDate(value: Date): string {
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium" }).format(value);
}

/** The first day of next month: when the monthly credit pool starts again. */
function nextMonthStart(now: Date): Date {
  return new Date(now.getFullYear(), now.getMonth() + 1, 1);
}

/** Threshold colours: warning from 80%, critical from 100%. */
function levelFor(percent: number): "ok" | "warn" | "bad" {
  if (percent >= 100) return "bad";
  if (percent >= 80) return "warn";
  return "ok";
}

function barColor(level: "ok" | "warn" | "bad"): "accent" | "warning" | "danger" {
  return level === "bad" ? "danger" : level === "warn" ? "warning" : "accent";
}

export default function UsagePanel() {
  const t = useTranslations("usage");
  const { activeSpace } = useActiveSpace();
  const [data, setData] = useState<UsageResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // Quota, credits and the session list belong to the Space in the switcher.
  const spaceId = activeSpace?.id ?? null;

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const query = spaceId ? `?spaceId=${encodeURIComponent(spaceId)}` : "";
      const response = await bffFetch(`/api/bff/usage${query}`, { cache: "no-store" });
      if (!response.ok) throw new Error(t("loadFailed"));
      setData((await response.json()) as UsageResponse);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : t("loadFailed"));
    } finally {
      setLoading(false);
    }
  }, [spaceId, t]);

  useEffect(() => {
    const task = window.setTimeout(() => {
      void load();
    }, 0);
    return () => window.clearTimeout(task);
  }, [load]);

  if (loading)
    return (
      <div className="flex items-center gap-2 text-sm" role="status">
        <Spinner size="sm" />
        <span>{t("loading")}</span>
      </div>
    );
  if (error)
    return (
      <div className="flex flex-col items-start gap-3">
        <FeedbackAlert status="danger">{error}</FeedbackAlert>
        <Button variant="secondary" onPress={() => void load()}>
          <RotateCcw aria-hidden="true" size={16} />
          {t("retry")}
        </Button>
      </div>
    );
  if (!data) return null;

  const credits = data.credits;
  const creditsLimit = credits?.limit ?? null;
  const creditsUsed = credits?.used ?? 0;
  const creditsLeft = creditsLimit === null ? null : Math.max(0, creditsLimit - creditsUsed);
  // The card headline is the remaining amount, so the bar must show the remaining share too.
  // It used to plot the used share, which made a nearly untouched allowance look empty.
  const creditsUsedPercent = creditsLimit ? Math.min(100, (creditsUsed / creditsLimit) * 100) : 0;
  const creditsLeftPercent = creditsLimit ? Math.min(100, (creditsLeft ?? 0) / creditsLimit * 100) : 0;
  const creditsLevel = levelFor(creditsUsedPercent);

  const storage = data.quota.storageGb;
  const storageUsed = storage.usage;
  const storageLeft = storageUsed === null ? null : Math.max(0, storage.limit - storageUsed);
  const storageUsedPercent = storage.limit > 0 && storageUsed !== null ? Math.min(100, (storageUsed / storage.limit) * 100) : 0;
  const storageLeftPercent = storage.limit > 0 && storageLeft !== null ? Math.min(100, (storageLeft / storage.limit) * 100) : 0;
  const storageLevel = levelFor(storageUsedPercent);

  const concurrent = data.concurrentSandboxes;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <h2 className="text-lg font-semibold">{t("quotaHeading")}</h2>
        <span className="workspace-meter-note">
          {t("lastUpdated", { when: formatDate(new Date(data.generatedAt)) })}
        </span>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <Card className="flex flex-col gap-3 p-5">
          <span className="text-sm" style={{ color: "var(--muted)" }}>{t("creditsHeading")}</span>
          <span className="text-3xl font-semibold tracking-tight">
            {creditsLeft === null ? "—" : formatNumber(creditsLeft, 1)}
          </span>
          <span className="text-sm">
            {creditsLimit === null
              ? t("creditsUnlimited")
              : t("creditsLeft", { remaining: formatNumber(creditsLeft, 1), limit: formatNumber(creditsLimit, 1) })}
          </span>
          <ProgressBar aria-label={t("creditsHeading")} value={creditsLeftPercent} color={barColor(creditsLevel)} size="sm">
            <ProgressBar.Track>
              <ProgressBar.Fill />
            </ProgressBar.Track>
          </ProgressBar>
          <span className="workspace-meter-note">
            {t("creditsResetsOn", { date: formatDate(nextMonthStart(new Date(data.generatedAt))) })}
          </span>
        </Card>

        <Card className="flex flex-col gap-3 p-5">
          <span className="text-sm" style={{ color: "var(--muted)" }}>{t("storageHeading")}</span>
          <span className="text-3xl font-semibold tracking-tight">
            {storageLeft === null ? "—" : formatStorage(storageLeft)}
          </span>
          <span className="text-sm">
            {storageUsed === null
              ? t("storageUnmeasured", { limit: formatStorage(storage.limit) })
              : t("storageRemaining", { remaining: formatStorage(storageLeft ?? 0), limit: formatStorage(storage.limit) })}
          </span>
          <ProgressBar aria-label={t("storageHeading")} value={storageLeftPercent} color={barColor(storageLevel)} size="sm">
            <ProgressBar.Track>
              <ProgressBar.Fill />
            </ProgressBar.Track>
          </ProgressBar>
        </Card>

        {concurrent ? (
          <Card className="flex flex-col gap-3 p-5">
            <span className="text-sm" style={{ color: "var(--muted)" }}>{t("concurrentHeading")}</span>
            <span className="text-3xl font-semibold tracking-tight">
              {formatNumber(concurrent.running, 0)}
            </span>
            <span className="text-sm">
              {t("concurrentOf", { running: concurrent.running, limit: formatNumber(concurrent.limit, 0) })}
            </span>
            <ProgressBar
              aria-label={t("concurrentHeading")}
              value={concurrent.limit ? Math.min(100, (concurrent.running / concurrent.limit) * 100) : 0}
              color="accent"
              size="sm">
              <ProgressBar.Track>
                <ProgressBar.Fill />
              </ProgressBar.Track>
            </ProgressBar>
          </Card>
        ) : null}
      </div>

      {data.resourceHistory ? (
        <ResourceHistory
          credits={data.resourceHistory.credits.map((point) => ({ date: point.date, value: point.credits }))}
          storage={data.resourceHistory.storage?.map((point) => ({ date: point.date, value: point.storageGb }))}
        />
      ) : null}

      {data.creditSessions ? <CreditSessionList sessions={data.creditSessions} /> : null}

      {data.storageByProject ? (
        <section aria-labelledby="storage-projects-heading" className="flex flex-col gap-4">
          <h2 id="storage-projects-heading" className="text-lg font-semibold">{t("storageByProjectHeading")}</h2>
          <Card className="p-5">
            {data.storageByProject.length === 0 ? (
              <p className="text-sm" style={{ color: "var(--muted)" }}>{t("storageByProjectEmpty")}</p>
            ) : (
              <ul className="flex flex-col gap-4">
                {data.storageByProject.map((project) => {
                  // The storage belongs to the Space, not to a single Project, so the share is
                  // labelled as a share of the Space's storage.
                  const share = shareOfSpaceStorage(project.storageGb, storage.limit);
                  return (
                    <li key={project.projectId} className="flex flex-col gap-1.5">
                      <div className="flex items-center justify-between gap-3 text-sm">
                        <span className="truncate">{project.name}</span>
                        <span className="shrink-0 font-medium">
                          {formatStorage(project.storageGb)} · {t("ofSpaceStorage", { percent: formatNumber(share, 1) })}
                        </span>
                      </div>
                      <ProgressBar aria-label={project.name} value={share} color="accent" size="sm">
                        <ProgressBar.Track>
                          <ProgressBar.Fill />
                        </ProgressBar.Track>
                      </ProgressBar>
                    </li>
                  );
                })}
              </ul>
            )}
          </Card>
        </section>
      ) : null}

      {creditsLimit !== null && creditsLimit > 0 && creditsUsedPercent >= 80 ? (
        <FeedbackAlert status="warning">{t("quotaWarningCredits")}</FeedbackAlert>
      ) : null}
    </div>
  );
}
