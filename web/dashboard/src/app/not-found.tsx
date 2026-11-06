import Link from "next/link";
import { Suspense } from "react";
import { getTranslations } from "next-intl/server";
import { Button } from "@heroui/react";
import { Home } from "lucide-react";

async function NotFoundBody() {
  const t = await getTranslations("common");
  return (
    <div className="max-w-md w-full text-center flex flex-col items-center gap-4">
      <h1 className="text-3xl font-semibold tracking-tight">404</h1>
      <p className="font-medium">{t("notFoundTitle")}</p>
      <p style={{ color: "var(--muted)" }}>{t("notFoundBody")}</p>
      <Link href="/">
        <Button variant="primary"><Home aria-hidden="true" size={16} />{t("backHome")}</Button>
      </Link>
    </div>
  );
}

export default function NotFound() {
  return (
    <main className="flex flex-1 items-center justify-center px-6 py-16">
      <Suspense fallback={null}>
        <NotFoundBody />
      </Suspense>
    </main>
  );
}
