import { getTranslations } from "next-intl/server";
import UsagePanel from "./UsagePanel";

export async function generateMetadata() {
  const t = await getTranslations("usage");
  return { title: `${t("title")} · ML Box` };
}

export default async function UsagePage() {
  const t = await getTranslations("usage");

  return (
    <div className="flex flex-col gap-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">{t("title")}</h1>
        <p className="text-sm" style={{ color: "var(--muted)" }}>{t("subtitle")}</p>
      </header>
      <UsagePanel />
    </div>
  );
}
