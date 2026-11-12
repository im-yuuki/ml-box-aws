"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { NextIntlClientProvider } from "next-intl";
import en from "@/messages/en.json";
import vi from "@/messages/vi.json";
import { DEFAULT_LOCALE, detectLocale, LOCALE_STORAGE_KEY, type Locale } from "./config";

const MESSAGES = { en, vi } as const;

/** The static export is rendered at build time without a time zone; the browser supplies its own, so that notice is expected. */
function ignoreEnvironmentFallback(error: { code: string }) {
  if (error.code !== "ENVIRONMENT_FALLBACK") console.error(error);
}

type LocaleContextValue = { locale: Locale; setLocale: (locale: Locale) => void };
const LocaleContext = createContext<LocaleContextValue>({ locale: DEFAULT_LOCALE, setLocale: () => {} });

export function useLocaleControl(): LocaleContextValue {
  return useContext(LocaleContext);
}

/**
 * The export is static, so the locale is chosen in the browser: the stored choice, else the browser language.
 * The first paint is English and switches on mount, which is the price of having no server at runtime.
 */
export default function LocaleProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>(DEFAULT_LOCALE);

  useEffect(() => {
    const task = window.setTimeout(() => {
      let stored: string | null = null;
      try {
        stored = localStorage.getItem(LOCALE_STORAGE_KEY);
      } catch {
        // Storage can be blocked; the browser language decides.
      }
      setLocaleState(detectLocale(stored, navigator.languages ?? [navigator.language]));
    }, 0);
    return () => window.clearTimeout(task);
  }, []);

  useEffect(() => {
    document.documentElement.lang = locale;
  }, [locale]);

  const setLocale = useCallback((next: Locale) => {
    setLocaleState(next);
    try {
      localStorage.setItem(LOCALE_STORAGE_KEY, next);
    } catch {
      // The choice still applies for this visit.
    }
  }, []);

  const value = useMemo(() => ({ locale, setLocale }), [locale, setLocale]);

  return (
    <LocaleContext.Provider value={value}>
      <NextIntlClientProvider locale={locale} messages={MESSAGES[locale]} onError={ignoreEnvironmentFallback}>
        {children}
      </NextIntlClientProvider>
    </LocaleContext.Provider>
  );
}
