"use client";

import { useTransition } from "react";
import { useLocale } from "next-intl";
import type { Locale } from "@/i18n/config";

/**
 * Returns the active locale and a setter. The setter posts the choice to
 * /api/locale (which sets the cookie) and reloads so server components
 * re-render every translated string at once.
 */
export function useSetLocale() {
  const current = useLocale() as Locale;
  const [isPending, startTransition] = useTransition();

  const setLocale = (next: Locale) => {
    if (next === current) return;
    startTransition(async () => {
      const res = await fetch("/api/locale", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ locale: next }),
      });
      if (res.ok) {
        window.location.reload();
      }
    });
  };

  return { current, isPending, setLocale };
}
