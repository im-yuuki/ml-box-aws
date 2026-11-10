import { getTranslations } from "next-intl/server";
import BillingPanel from "./BillingPanel";

export async function generateMetadata() {
  const t = await getTranslations("account");
  return { title: `${t("tabs.subscription")} · MLBox` };
}

/** Subscription: current plan, plan selection and payment history. */
export default async function SubscriptionPage() {
  const t = await getTranslations("account");

  return (
    <div className="flex flex-col gap-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">{t("tabs.subscription")}</h1>
      </header>
      <BillingPanel />
    </div>
  );
}
