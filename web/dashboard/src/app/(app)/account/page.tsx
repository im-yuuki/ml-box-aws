import { getTranslations } from "next-intl/server";
import { Card } from "@heroui/react";

export async function generateMetadata() {
  const t = await getTranslations("account");
  return { title: `${t("title")} · ML Box` };
}

export default async function AccountPage() {
  const t = await getTranslations("account");

  return (
    <div className="flex flex-col gap-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">{t("title")}</h1>
        <p className="text-sm" style={{ color: "var(--muted)" }}>
          {t("subtitle")}
        </p>
      </header>
      <Card className="flex flex-col gap-3 p-5">
        <h2 className="text-base font-medium">{t("emailHeading")}</h2>
        <p className="text-sm" style={{ color: "var(--muted)" }}>
          {t("emailPlaceholder")}
        </p>
      </Card>
      <Card className="flex flex-col gap-3 p-5">
        <h2 className="text-base font-medium">{t("passwordHeading")}</h2>
        <p className="text-sm" style={{ color: "var(--muted)" }}>
          {t("passwordBody")}
        </p>
        <p className="text-xs" style={{ color: "var(--muted)" }}>
          {t("passwordHint")}
        </p>
      </Card>
    </div>
  );
}
