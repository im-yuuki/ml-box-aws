"use client";

import { useState } from "react";
import { useFormatter, useTranslations } from "next-intl";
import PageHeading from "@/components/PageHeading";
import PageError from "@/components/PageState";
import Section from "@/components/Section";
import StatCard from "@/components/StatCard";
import { useSession } from "@/components/SessionProvider";
import { useApi } from "@/hooks/useApi";
import type { CostResponse, Section as SectionResult } from "@/lib/types";

function ServiceBar({ label, ratio, amount }: { label: string; ratio: number; amount: string }) {
  return (
    <div className="admin-bar-row">
      <span>{label}</span>
      <svg viewBox="0 0 100 12" preserveAspectRatio="none" role="img" aria-label={`${label}: ${amount}`} className="h-3 w-full">
        <rect width="100" height="12" rx="2" style={{ fill: "var(--surface-tertiary)" }} />
        <rect width={Math.max(ratio * 100, 0.8)} height="12" rx="2" style={{ fill: "var(--accent)" }} />
      </svg>
      <span className="text-right tabular-nums">{amount}</span>
    </div>
  );
}

/** One bar per day. The pointed day is printed below, so the value is readable on a touch device that has no tooltip. */
function DailyBars({ daily, currency }: { daily: CostResponse["daily"]; currency: string }) {
  const t = useTranslations("cost");
  const format = useFormatter();
  const [active, setActive] = useState<number | null>(null);
  const width = 600;
  const height = 140;
  const gap = 3;
  const barWidth = daily.length > 0 ? (width - gap * (daily.length - 1)) / daily.length : 0;
  const max = Math.max(1, ...daily.map((day) => day.amount));
  const peak = daily.reduce((best, day, index) => (day.amount > daily[best].amount ? index : best), 0);
  const shown = active ?? peak;
  const money = (value: number) => format.number(value, { style: "currency", currency, maximumFractionDigits: 2 });

  if (daily.length === 0 || daily.every((day) => day.amount === 0)) {
    return (
      <p className="text-sm" style={{ color: "var(--muted)" }}>
        {t("empty")}
      </p>
    );
  }
  return (
    <figure className="flex flex-col gap-2">
      <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label={t("chartLabel")} className="h-36 w-full">
        {daily.map((day, index) => {
          const barHeight = (day.amount / max) * (height - 4);
          return (
            <rect
              key={day.date}
              x={index * (barWidth + gap)}
              y={height - barHeight}
              width={barWidth}
              height={barHeight}
              rx={2}
              style={{ fill: "var(--accent)", opacity: active === null || active === index ? 1 : 0.45 }}
              onPointerEnter={() => setActive(index)}
              onPointerLeave={() => setActive(null)}
              onPointerDown={() => setActive(index)}>
              <title>{`${day.date}: ${money(day.amount)}`}</title>
            </rect>
          );
        })}
      </svg>
      <figcaption className="flex items-center justify-between gap-3 text-xs" style={{ color: "var(--muted)" }}>
        <span>{daily[0].date}</span>
        <span>
          {active === null ? `${t("peak")}: ` : ""}
          {daily[shown].date} · {money(daily[shown].amount)}
        </span>
        <span>{daily[daily.length - 1].date}</span>
      </figcaption>
    </figure>
  );
}

export default function CostPage() {
  const t = useTranslations("cost");
  const format = useFormatter();
  const { session } = useSession();
  const enabled = session.status === "authenticated" && session.features.costExplorer;
  const { data, error, loading, reload } = useApi<SectionResult<CostResponse>>(enabled ? "/api/cost" : null);

  return (
    <>
      <PageHeading eyebrow={t("eyebrow")} title={t("title")} subtitle={t("subtitle")} onRefresh={enabled ? reload : undefined} loading={loading} />
      <div className="admin-stack">
        {!enabled ? (
          <p className="text-sm" style={{ color: "var(--muted)" }}>
            {t("disabled")}
          </p>
        ) : (
          <>
            <PageError message={error} />
            <Section title={t("title")} result={data}>
              {(cost) => {
                const money = (value: number) => format.number(value, { style: "currency", currency: cost.currency, maximumFractionDigits: 2 });
                const max = Math.max(1, ...cost.services.map((service) => service.amount));
                return (
                  <div className="flex flex-col gap-6">
                    <div className="admin-stat-grid">
                      <StatCard label={t("total")} value={money(cost.total)} hint={`${cost.period.start} → ${cost.period.end}`} />
                      <StatCard label={t("average")} value={money(cost.total / Math.max(cost.daily.length, 1))} />
                    </div>
                    <div className="flex flex-col gap-3">
                      <h3 className="workspace-mono-label">{t("byService")}</h3>
                      {cost.services.map((service) => (
                        <ServiceBar key={service.name} label={service.name} ratio={service.amount / max} amount={money(service.amount)} />
                      ))}
                    </div>
                    <div className="flex flex-col gap-3">
                      <h3 className="workspace-mono-label">{t("byDay")}</h3>
                      <DailyBars daily={cost.daily} currency={cost.currency} />
                    </div>
                  </div>
                );
              }}
            </Section>
          </>
        )}
      </div>
    </>
  );
}
