"use client";

import { useFormatter, useTranslations } from "next-intl";

export default function DateTime({ value }: { value: string | null | undefined }) {
  const format = useFormatter();
  const t = useTranslations("common");
  if (!value || Number.isNaN(new Date(value).getTime())) return <>{t("none")}</>;
  return <time dateTime={value}>{format.dateTime(new Date(value), { dateStyle: "medium", timeStyle: "short" })}</time>;
}
