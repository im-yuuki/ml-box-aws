"use client";

import { Button, Card } from "@heroui/react";
import { useTranslations } from "next-intl";

type HubActivationCardProps = {
  activationUrl: string;
  onCheck: () => void;
  compact?: boolean;
};

function trustedActivationUrl(value: string): string | null {
  try {
    const url = new URL(value);
    return url.protocol === "https:" ? url.toString() : null;
  } catch {
    return null;
  }
}

export default function HubActivationCard({ activationUrl, onCheck, compact = false }: HubActivationCardProps) {
  const t = useTranslations("sandboxes");
  const safeUrl = trustedActivationUrl(activationUrl);

  if (!safeUrl) return null;

  return (
    <Card className={compact ? "flex flex-col gap-3 p-4" : "flex flex-col gap-4 p-5"} style={{ borderColor: "var(--warning)" }}>
      <div className="flex flex-col gap-1">
        <h2 className="text-base font-medium">{t("hubActivationHeading")}</h2>
        <p className="text-sm" style={{ color: "var(--muted)" }}>{t("hubActivationBody")}</p>
      </div>
      <div className="flex flex-wrap gap-3">
        {safeUrl ? <a className="inline-flex h-9 items-center rounded-md bg-[var(--primary)] px-3 text-sm font-medium text-[var(--primary-foreground)]" href={safeUrl} target="_blank" rel="noreferrer">{t("openHub")}</a> : null}
        <Button size="sm" variant="secondary" onPress={onCheck}>{t("checkHubStatus")}</Button>
      </div>
    </Card>
  );
}
