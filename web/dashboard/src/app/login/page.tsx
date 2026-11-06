import { Suspense } from "react";
import { getTranslations } from "next-intl/server";
import AuthShell from "@/components/AuthShell";
import LoginForm from "./LoginForm";

export async function generateMetadata() {
  const t = await getTranslations("login");
  return { title: `${t("title")} · MLBox` };
}

export default async function LoginPage() {
  const t = await getTranslations("login");
  const tCommon = await getTranslations("common");

  return (
    <AuthShell
      title={t("title")}
      appName={tCommon("appName")}
      homeLabel={tCommon("homeLabel")}
    >
      <Suspense fallback={null}>
        <LoginForm />
      </Suspense>
    </AuthShell>
  );
}
