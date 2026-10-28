import { getTranslations } from "next-intl/server";
import PasswordRecoveryForm from "../forgot-password/PasswordRecoveryForm";

export async function generateMetadata() {
  const t = await getTranslations("forgotPassword");
  return { title: `${t("resetTitle")} · ML Box` };
}

export default async function ResetPasswordPage() {
  const t = await getTranslations("forgotPassword");
  return <main className="flex flex-1 items-center justify-center px-6 py-16"><div className="w-full max-w-sm flex flex-col gap-6">
    <header className="flex flex-col items-center gap-2 text-center"><h1 className="text-2xl font-semibold tracking-tight">{t("resetTitle")}</h1><p className="text-sm" style={{ color: "var(--muted)" }}>{t("resetSubtitle")}</p></header>
    <PasswordRecoveryForm mode="reset" />
  </div></main>;
}
