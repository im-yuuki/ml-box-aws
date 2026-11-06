import { Suspense } from "react";
import { getTranslations } from "next-intl/server";
import AuthShell from "@/components/AuthShell";
import RegisterForm from "./RegisterForm";

export async function generateMetadata() {
  const t = await getTranslations("register");
  return { title: `${t("title")} · MLBox` };
}

export default async function RegisterPage() {
  const t = await getTranslations("register");
  const tCommon = await getTranslations("common");

  return (
    <AuthShell
      title={t("title")}
      appName={tCommon("appName")}
      homeLabel={tCommon("homeLabel")}
    >
      <Suspense fallback={null}>
        <RegisterForm />
      </Suspense>
    </AuthShell>
  );
}
