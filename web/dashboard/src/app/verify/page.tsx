import { Suspense } from "react";
import { getTranslations } from "next-intl/server";
import VerifyForm from "./VerifyForm";

export async function generateMetadata() {
  const t = await getTranslations("verify");
  return { title: `${t("title")} · ML Box` };
}

export default async function VerifyPage() {
  const t = await getTranslations("verify");
  return <main className="flex flex-1 items-center justify-center px-6 py-16"><div className="w-full max-w-sm flex flex-col gap-6">
    <header className="flex flex-col items-center gap-2 text-center"><h1 className="text-2xl font-semibold tracking-tight">{t("title")}</h1><p className="text-sm" style={{ color: "var(--muted)" }}>{t("subtitle")}</p></header>
    <Suspense fallback={null}><VerifyForm /></Suspense>
  </div></main>;
}
