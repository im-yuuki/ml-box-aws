"use client";

import { useFormatter, useTranslations } from "next-intl";
import { useRelativeText } from "@/hooks/useRelativeText";

/** "5 minutes ago" in the language of the console, with the exact time in the tooltip. */
export default function RelativeTime({ value }: { value: string | null | undefined }) {
  const format = useFormatter();
  const t = useTranslations("common");
  const text = useRelativeText(value);
  if (!text || !value) return <>{t("none")}</>;
  return (
    <time dateTime={value} title={format.dateTime(new Date(value), { dateStyle: "medium", timeStyle: "medium" })}>
      {text}
    </time>
  );
}
