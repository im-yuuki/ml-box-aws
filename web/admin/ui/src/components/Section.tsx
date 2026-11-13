"use client";

import { Card } from "@heroui/react";
import type { ReactNode } from "react";
import { useTranslations } from "next-intl";
import CardSectionTitle from "@/components/CardSectionTitle";
import FeedbackAlert from "@/components/FeedbackAlert";
import { useRelativeText } from "@/hooks/useRelativeText";
import type { Section as SectionResult } from "@/lib/types";

/**
 * A card for one data source. Each source of the console can fail on its own (a missing IAM permission, a database that
 * is down), so the failure is shown in the card that depends on it and the rest of the page keeps working.
 */
export default function Section<T>({
  title,
  result,
  children,
}: {
  title: string;
  result: SectionResult<T> | null | undefined;
  children: (data: T) => ReactNode;
}) {
  const t = useTranslations("common");
  const relative = useRelativeText(result?.fetchedAt);
  return (
    <Card className="flex flex-col gap-4 p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <CardSectionTitle>{title}</CardSectionTitle>
        {result ? (
          <span className="workspace-count-label">{t("updated", { time: relative ?? t("none") })}</span>
        ) : null}
      </div>
      {!result ? (
        <p className="text-sm" style={{ color: "var(--muted)" }}>
          {t("loading")}
        </p>
      ) : result.ok ? (
        children(result.data)
      ) : (
        <FeedbackAlert status="danger">{result.error}</FeedbackAlert>
      )}
    </Card>
  );
}
