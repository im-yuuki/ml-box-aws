import { getTranslations } from "next-intl/server";
import NewSandboxForm from "./NewSandboxForm";

export async function generateMetadata() {
  const t = await getTranslations("sandboxes");
  return { title: `${t("new")} · ML Box` };
}

export default async function NewSandboxPage() {
  const t = await getTranslations("sandboxes");

  return (
    <div className="flex flex-col gap-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">{t("new")}</h1>
        <p className="text-sm" style={{ color: "var(--muted)" }}>{t("newSubtitle")}</p>
      </header>
      <NewSandboxForm />
    </div>
  );
}