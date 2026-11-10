"use client";

import { Card } from "@heroui/react";
import { useTranslations } from "next-intl";

export type HistoryPoint = { date: string; value: number };

function shortDate(iso: string): string {
  return new Intl.DateTimeFormat(undefined, { day: "numeric", month: "short", timeZone: "UTC" }).format(new Date(`${iso}T00:00:00Z`));
}

/** One bar per day. Hovering a bar shows its date and value; the axis shows the first and last day. */
function DailyBars({ label, unit, points, digits }: { label: string; unit: string; points: HistoryPoint[]; digits: number }) {
  const width = 600;
  const height = 140;
  const gap = 3;
  const barWidth = points.length > 0 ? (width - gap * (points.length - 1)) / points.length : 0;
  const max = Math.max(1, ...points.map((point) => point.value));
  const formatter = new Intl.NumberFormat(undefined, { maximumFractionDigits: digits });

  return (
    <figure className="flex flex-col gap-2">
      <figcaption className="text-sm font-medium">{label}</figcaption>
      <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label={label} className="h-36 w-full">
        {points.map((point, index) => {
          const barHeight = (point.value / max) * (height - 4);
          return (
            <rect
              key={point.date}
              x={index * (barWidth + gap)}
              y={height - barHeight}
              width={barWidth}
              height={barHeight}
              rx={2}
              style={{ fill: "var(--accent)" }}>
              <title>{`${shortDate(point.date)}: ${formatter.format(point.value)} ${unit}`}</title>
            </rect>
          );
        })}
      </svg>
      {points.length > 0 ? (
        <div className="flex justify-between text-xs" style={{ color: "var(--muted)" }}>
          <span>{shortDate(points[0].date)}</span>
          <span>{shortDate(points[points.length - 1].date)}</span>
        </div>
      ) : null}
    </figure>
  );
}

/** Credits used per day over the last 30 days. */
export default function ResourceHistory({ credits }: { credits: HistoryPoint[] }) {
  const t = useTranslations("usage");
  return (
    <section aria-labelledby="history-heading" className="flex flex-col gap-4">
      <h2 id="history-heading" className="text-lg font-semibold">{t("historyHeading")}</h2>
      <Card className="p-5">
        <DailyBars label={t("historyCredits")} unit="credits" points={credits} digits={1} />
      </Card>
    </section>
  );
}
