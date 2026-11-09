import { getTranslations } from "next-intl/server";
import SessionsCard from "@/components/account/SessionsCard";

export async function generateMetadata() {
  const t = await getTranslations("account");
  return { title: `${t("tabs.security")} · MLBox` };
}

/** Sign-in sessions: see each signed-in device and sign it out. */
export default async function SecurityPage() {
  const t = await getTranslations("account");

  return (
    <div className="flex flex-col gap-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">{t("tabs.security")}</h1>
      </header>
      <SessionsCard />
    </div>
  );
}
