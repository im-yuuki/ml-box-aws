import { getTranslations } from "next-intl/server";
import ProfileCard from "@/components/account/ProfileCard";

export async function generateMetadata() {
  const t = await getTranslations("account");
  return { title: `${t("title")} · MLBox` };
}

/** Personal details, avatar and email. Password and sessions live on the Security page. */
export default async function AccountPage() {
  const t = await getTranslations("account");

  return (
    <div className="flex flex-col gap-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">{t("title")}</h1>
      </header>
      <ProfileCard />
    </div>
  );
}
