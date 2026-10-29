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
    <div className="flex flex-col gap-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">{t("title")}</h1>
        <p className="text-sm" style={{ color: "var(--muted)" }}>
          {t("subtitle")}
        </p>
      </header>
      <AccountPanel />
      <BillingPanel />
    </div>
  );
}
