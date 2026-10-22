import { Suspense } from "react";
import { getTranslations } from "next-intl/server";
import RegisterForm from "./RegisterForm";

export async function generateMetadata() {
  const t = await getTranslations("register");
  return { title: `${t("title")} · ML Box` };
}

export default async function RegisterPage() {
  const t = await getTranslations("register");
  const tCommon = await getTranslations("common");

  return (
    <main className="flex flex-1 items-center justify-center px-6 py-16">
      <div className="w-full max-w-sm flex flex-col gap-6">
        <header className="flex flex-col items-center gap-2 text-center">
          <span
            className="inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs"
            style={{
              borderColor: "var(--border)",
              color: "var(--muted)",
            }}
          >
            {tCommon("appName")}
          </span>
          <h1 className="text-2xl font-semibold tracking-tight">{t("title")}</h1>
          <p className="text-sm" style={{ color: "var(--muted)" }}>
            {t("subtitle")}
          </p>
        </header>
        <Suspense fallback={null}>
          <RegisterForm />
        </Suspense>
      </div>
    </main>
  );
}
