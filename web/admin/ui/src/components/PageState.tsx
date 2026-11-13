"use client";

import { useTranslations } from "next-intl";
import FeedbackAlert from "@/components/FeedbackAlert";

/** Shown when the request for the whole page failed, as opposed to one card inside it. */
export default function PageError({ message }: { message: string | null }) {
  const t = useTranslations("common");
  if (!message) return null;
  return <FeedbackAlert status="danger">{t("loadFailed", { message })}</FeedbackAlert>;
}
