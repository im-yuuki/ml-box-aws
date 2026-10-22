"use client";

import { useTransition } from "react";
import { useLocale } from "next-intl";
import { Button } from "@heroui/react";
import { locales, localeLabels, type Locale } from "@/i18n/config";

/**
 * Two-state toggle: EN | VI. Posts the chosen locale to /api/locale,
 * which sets the cookie; the next request re-renders with the new
 * messages.
 */
export default function LocaleSwitcher() {
  const current = useLocale() as Locale;
  const [isPending, startTransition] = useTransition();

  const onSelect = (next: Locale) => {
    if (next === current) return;
    startTransition(async () => {
      const res = await fetch("/api/locale", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ locale: next }),
      });
      if (res.ok) {
        // Reload the page so server components pick up the new cookie
        // and re-render every translated string at once.
        window.location.reload();
      }
    });
  };

  return (
    <div
      role="group"
      aria-label="Language"
      className="inline-flex items-center rounded-md border p-0.5"
      style={{ borderColor: "var(--border)" }}
    >
      {locales.map((loc) => {
        const active = loc === current;
        return (
          <Button
            key={loc}
            type="button"
            size="sm"
            variant={active ? "primary" : "tertiary"}
            isDisabled={isPending}
            onPress={() => onSelect(loc)}
            aria-pressed={active}
            className="min-w-0 px-3"
          >
            {localeLabels[loc]}
          </Button>
        );
      })}
    </div>
  );
}
