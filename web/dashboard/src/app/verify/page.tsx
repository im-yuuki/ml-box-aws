import { Suspense } from "react";
import { getTranslations } from "next-intl/server";
import VerifyForm from "./VerifyForm";
import AuthShell from "@/components/AuthShell";

export async function generateMetadata() {
  const t = await getTranslations("verify");
  return { title: `${t("title")} · MLBox` };
}

export default async function VerifyPage() {
  const t = await getTranslations("verify");
  const tCommon = await getTranslations("common");

  return (
    <AuthShell
      title={t("title")}
      appName={tCommon("appName")}
      homeLabel={tCommon("homeLabel")}>
      <Suspense fallback={null}>
        <VerifyForm />
      </Suspense>
    </AuthShell>
  );
}
