"use client";

import { Spinner } from "@heroui/react";
import { useTranslations } from "next-intl";
import AppShell from "@/components/AppShell";
import LoginForm from "@/components/LoginForm";
import { useSession } from "@/components/SessionProvider";

/** Nothing of the console renders before the backend has confirmed the session. */
export default function AdminGate({ children }: { children: React.ReactNode }) {
  const { session } = useSession();
  const t = useTranslations("common");

  if (session.status === "loading") {
    return (
      <div className="admin-login" role="status">
        <Spinner size="lg" aria-label={t("loading")} />
      </div>
    );
  }
  if (session.status === "anonymous") return <LoginForm />;
  return <AppShell>{children}</AppShell>;
}
