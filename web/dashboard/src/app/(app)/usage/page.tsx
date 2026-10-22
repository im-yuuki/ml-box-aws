import { getTranslations } from "next-intl/server";
import { Card, ProgressBar } from "@heroui/react";

export async function generateMetadata() {
  const t = await getTranslations("usage");
  return { title: `${t("title")} · ML Box` };
}

const usage = {
  cpuHours: { used: 4.2, quota: 32 },
  ramGb: { used: 6, quota: 24 },
  storageGb: { used: 1.2, quota: 20 },
  gpuHours: { used: 0, quota: 0 },
} as const;

function pct(used: number, quota: number): number {
  if (quota <= 0) return 0;
  return Math.min(100, Math.round((used / quota) * 100));
}

export default async function UsagePage() {
  const t = await getTranslations("usage");

  const cards = [
    { key: "cpuHours" as const, label: t("cpuHours"), unit: t("unitHours"), data: usage.cpuHours },
    { key: "ram" as const, label: t("ram"), unit: t("unitGb"), data: usage.ramGb },
    { key: "storage" as const, label: t("storage"), unit: t("unitGb"), data: usage.storageGb },
    { key: "gpuHours" as const, label: t("gpuHours"), unit: t("unitHours"), data: usage.gpuHours },
  ];

  return (
    <div className="flex flex-col gap-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">{t("title")}</h1>
        <p className="text-sm" style={{ color: "var(--muted)" }}>
          {t("subtitle")}
        </p>
      </header>
      <div className="grid gap-4 sm:grid-cols-2">
        {cards.map((c) => {
          const value = pct(c.data.used, c.data.quota);
          return (
            <Card key={c.key} className="flex flex-col gap-3 p-5">
              <div className="flex items-center justify-between">
                <span className="text-sm" style={{ color: "var(--muted)" }}>
                  {c.label}
                </span>
                <span className="text-sm font-medium">
                  {c.data.used} / {c.data.quota} {c.unit}
                </span>
              </div>
              <ProgressBar
                value={value}
                aria-label={c.label}
                color={value > 80 ? "warning" : "accent"}
              />
            </Card>
          );
        })}
      </div>
    </div>
  );
}
