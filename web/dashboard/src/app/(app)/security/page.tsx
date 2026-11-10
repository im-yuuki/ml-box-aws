import { getTranslations } from "next-intl/server";
import SessionsCard from "@/components/account/SessionsCard";
import PasswordCard from "@/components/account/PasswordCard";

export async function generateMetadata() {
  const t = await getTranslations("account");
  return { title: `${t("tabs.security")} · MLBox` };
}

/** Password and sign-in sessions: change the password, and see and sign out each signed-in device. */
export default async function SecurityPage() {
  const t = await getTranslations("account");

  return (
    <div className="flex flex-col gap-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">{t("tabs.security")}</h1>
      </header>
      <PasswordCard />
      <SessionsCard />
    </div>
  );
}
