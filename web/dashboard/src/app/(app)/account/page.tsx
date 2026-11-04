import { getTranslations } from "next-intl/server";
import AccountPanel from "./AccountPanel";
import BillingPanel from "./BillingPanel";

export async function generateMetadata() {
  const t = await getTranslations("account");
  return { title: `${t("title")} · ML Box` };
}

export default async function AccountPage() {
  const t = await getTranslations("account");

  return (
    <div className="page">
      <header className="page-header">
        <div className="page-header-text">
          <h1 className="page-title">{t("title")}</h1>
          <p className="page-lede">{t("subtitle")}</p>
        </div>
      </header>
      <AccountPanel />
      <BillingPanel />
    </div>
  );
}
