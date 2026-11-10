import { getTranslations } from "next-intl/server";
import UsagePanel from "@/components/UsagePanel";

export async function generateMetadata() {
  const t = await getTranslations("account");
  return { title: `${t("tabs.quota")} · MLBox` };
}

/** Quota: limits, current footprint and recorded usage. */
export default async function QuotaPage() {
  const t = await getTranslations("account");

  return (
    <div className="flex flex-col gap-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">{t("tabs.quota")}</h1>
      </header>
      <UsagePanel />
    </div>
  );
}
