import { getTranslations } from "next-intl/server";
import PasswordRecoveryForm from "./PasswordRecoveryForm";
import AuthShell from "@/components/AuthShell";
import { Suspense } from "react";

export async function generateMetadata() {
  const t = await getTranslations("forgotPassword");
  return { title: `${t("title")} · MLBox` };
}

export default async function ForgotPasswordPage() {
  const t = await getTranslations("forgotPassword");
  const tCommon = await getTranslations("common");

  return (
    <AuthShell
      title={t("title")}
      appName={tCommon("appName")}
      homeLabel={tCommon("homeLabel")}>
      <Suspense fallback={null}>
        <PasswordRecoveryForm mode="forgot" />
      </Suspense>
    </AuthShell>
  );
}
