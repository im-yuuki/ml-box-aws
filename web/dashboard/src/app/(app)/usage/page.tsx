import { getTranslations } from "next-intl/server";
import UsagePanel from "./UsagePanel";

export async function generateMetadata() {
  const t = await getTranslations("usage");
  return { title: `${t("title")} · ML Box` };
}

export default async function UsagePage() {
  const t = await getTranslations("usage");

  return (
    <div className="page">
      <header className="page-header">
        <div className="page-header-text">
          <h1 className="page-title">{t("title")}</h1>
          <p className="page-lede">{t("subtitle")}</p>
        </div>
      </header>
      <UsagePanel />
    </div>
  );
}
