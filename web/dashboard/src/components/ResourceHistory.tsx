"use client";

import { useState } from "react";
import { Card } from "@heroui/react";
import { useTranslations } from "next-intl";

export type HistoryPoint = { date: string; value: number };

function shortDate(iso: string): string {
  return new Intl.DateTimeFormat(undefined, { day: "numeric", month: "short", timeZone: "UTC" }).format(new Date(`${iso}T00:00:00Z`));
}

/**
 * One bar per day. The value of the pointed bar is printed below the chart, so the numbers are
 * readable without a mouse: the value used to live only in the tooltip of the SVG, which a touch
 * device never shows.
 */
function DailyBars({
  label,
  unit,
  points,
  digits,
  color,
  emptyLabel,
}: {
  label: string;
  unit: string;
  points: HistoryPoint[];
  digits: number;
  color: string;
  emptyLabel: string;
}) {
  const width = 600;
  const height = 140;
  const gap = 3;
  const barWidth = points.length > 0 ? (width - gap * (points.length - 1)) / points.length : 0;
  const max = Math.max(1, ...points.map((point) => point.value));
  const formatter = new Intl.NumberFormat(undefined, { maximumFractionDigits: digits });
  const [active, setActive] = useState<number | null>(null);

  // The highest day is the useful default when nothing is pointed at.
  const peak = points.reduce((best, point, index) => (point.value > points[best].value ? index : best), 0);
  const shown = active === null ? peak : active;
  const shownPoint = points[shown];

  if (points.length === 0) {
    return (
      <figure className="flex flex-col gap-2">
        <figcaption className="text-sm font-medium">{label}</figcaption>
        <p className="text-sm" style={{ color: "var(--muted)" }}>{emptyLabel}</p>
      </figure>
    );
  }

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
              style={{ fill: color, opacity: active === null || active === index ? 1 : 0.45 }}
              onPointerEnter={() => setActive(index)}
              onPointerLeave={() => setActive(null)}
              onPointerDown={() => setActive(index)}>
              <title>{`${shortDate(point.date)}: ${formatter.format(point.value)} ${unit}`}</title>
            </rect>
          );
        })}
      </svg>
      <div className="flex items-center justify-between gap-3 text-xs" style={{ color: "var(--muted)" }}>
        <span>{shortDate(points[0].date)}</span>
        <span aria-live="polite">
          {shownPoint ? `${shortDate(shownPoint.date)}: ${formatter.format(shownPoint.value)} ${unit}` : null}
        </span>
        <span>{shortDate(points[points.length - 1].date)}</span>
      </div>
      {/* The chart can only be read with a pointer. The same numbers are in a table, so a screen
          reader and a text browser can read every day. */}
      <table className="sr-only">
        <caption>{label}</caption>
        <thead>
          <tr>
            <th scope="col">Date</th>
            <th scope="col">{label}</th>
          </tr>
        </thead>
        <tbody>
          {points.map((point) => (
            <tr key={point.date}>
              <td>{shortDate(point.date)}</td>
              <td>{`${formatter.format(point.value)} ${unit}`}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </figure>
  );
}

/** Credits used per day and storage held per day over the last 30 days. */
export default function ResourceHistory({
  credits,
  storage,
}: {
  credits: HistoryPoint[];
  storage?: HistoryPoint[];
}) {
  const t = useTranslations("usage");
  return (
    <section aria-labelledby="history-heading" className="flex flex-col gap-4">
      <h2 id="history-heading" className="text-lg font-semibold">{t("historyHeading")}</h2>
      <Card className="flex flex-col gap-6 p-5">
        <DailyBars
          label={t("historyCredits")}
          unit="credits"
          points={credits}
          digits={1}
          color="var(--accent)"
          emptyLabel={t("historyNoData")}
        />
        {storage ? (
          <DailyBars
            label={t("historyStorage")}
            unit="GB"
            points={storage}
            digits={2}
            color="var(--chart-2, var(--accent))"
            emptyLabel={t("historyNoData")}
          />
        ) : null}
      </Card>
    </section>
  );
}
