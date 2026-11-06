"use client";

import { CartesianGrid, Area, AreaChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

export type UsagePoint = { time: string; value: number | null };

/** Time-series area chart for one usage metric. Null samples break the line instead of dropping to zero. */
export default function UsageChart({
  title,
  unit,
  points,
  emptyLabel,
}: {
  title: string;
  unit: string;
  points: UsagePoint[];
  emptyLabel: string;
}) {
  const data = points.map((point) => ({ time: point.time, value: point.value }));
  const hasValues = data.some((point) => point.value !== null);
  if (!hasValues) return <p className="workspace-muted-copy">{emptyLabel}</p>;

  const formatTime = (value: string) => {
    const date = new Date(value);
    return Number.isNaN(date.valueOf())
      ? value
      : new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }).format(date);
  };

  return (
    <figure className="workspace-chart-figure" aria-label={title}>
      <figcaption className="workspace-meter-note mb-2">{title} · {unit}</figcaption>
      <div className="workspace-chart" style={{ color: "var(--accent)" }}>
        <ResponsiveContainer width="100%" height={220}>
          <AreaChart data={data} margin={{ top: 12, right: 16, bottom: 4, left: 0 }}>
            <CartesianGrid vertical={false} />
            <XAxis dataKey="time" tickFormatter={formatTime} minTickGap={32} tickLine={false} axisLine={false} />
            <YAxis allowDecimals={false} tickLine={false} axisLine={false} width={44} />
            <Tooltip
              labelFormatter={(value) => formatTime(String(value))}
              formatter={(value) => [`${value} ${unit}`, title]}
              contentStyle={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 8, color: "var(--foreground)" }}
            />
            <Area type="monotone" dataKey="value" stroke="currentColor" fill="currentColor" fillOpacity={0.12} strokeWidth={2} connectNulls={false} dot={false} activeDot={{ r: 4 }} />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </figure>
  );
}
