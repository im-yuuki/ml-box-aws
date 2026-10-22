import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { Button } from "@heroui/react";
import LocaleSwitcher from "@/components/LocaleSwitcher";

export default async function Home() {
  const t = await getTranslations("home");
  const tCommon = await getTranslations("common");
  const tNav = await getTranslations("nav");

  return (
    <main className="flex flex-1 items-center justify-center px-6 py-16">
      <div className="max-w-xl w-full text-center flex flex-col items-center gap-6">
        <div className="flex items-center gap-2">
          <span
            className="inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs"
            style={{
              borderColor: "var(--border)",
              color: "var(--muted)",
            }}
          >
            {tCommon("dashboardPreview")}
          </span>
          <LocaleSwitcher />
        </div>
        <h1 className="text-4xl font-semibold tracking-tight">{t("title")}</h1>
        <p className="text-base max-w-md" style={{ color: "var(--muted)" }}>
          {t("subtitle")}
        </p>
        <div className="flex flex-col sm:flex-row gap-3">
          <Link href="/login">
            <Button variant="primary" size="lg">
              {t("signIn")}
            </Button>
          </Link>
          <Link href="/register">
            <Button variant="secondary" size="lg">
              {t("createAccount")}
            </Button>
          </Link>
        </div>
        <p className="text-xs mt-6" style={{ color: "var(--muted)" }}>
          {t("orJump", {
            sandboxes: tNav("sandboxes"),
            usage: tNav("usage"),
          })}
        </p>
      </div>
    </main>
  );
}
