import { getTranslations } from "next-intl/server";
import { Button } from "@heroui/react";
import Link from "next/link";
import SandboxList from "./SandboxList";

export async function generateMetadata() {
  const t = await getTranslations("sandboxes");
  return { title: `${t("title")} · ML Box` };
}

export default async function SandboxesPage() {
  const t = await getTranslations("sandboxes");

  return (
    <div className="flex flex-col gap-6">
      <header className="flex items-end justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{t("title")}</h1>
          <p className="text-sm" style={{ color: "var(--muted)" }}>{t("subtitle")}</p>
        </div>
        <Link href="/sandboxes/new"><Button variant="primary">{t("new")}</Button></Link>
      </header>
      <SandboxList />
    </div>
  );
}
