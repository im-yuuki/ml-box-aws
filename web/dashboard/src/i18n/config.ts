/**
 * Locales the dashboard ships in.
 *
 * Keep this list short: every new entry needs its own message file and
 * translation review.
 */
export const locales = ["en", "vi"] as const;
export type Locale = (typeof locales)[number];

/** The cookie key the locale switcher writes to. */
export const LOCALE_COOKIE = "mlbox-locale";

/** Fallback used when no cookie and no Accept-Language match wins. */
export const DEFAULT_LOCALE: Locale = "en";

/** Readable labels for the locale switcher UI. */
export const localeLabels: Record<Locale, string> = {
  en: "English",
  vi: "Tiếng Việt",
};

export function isLocale(value: unknown): value is Locale {
  return typeof value === "string" && (locales as readonly string[]).includes(value);
}
