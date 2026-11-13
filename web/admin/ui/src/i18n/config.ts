/** Locales of the console. Same list and storage key as the dashboard, so an operator sees one product. */
export const locales = ["en", "vi"] as const;
export type Locale = (typeof locales)[number];

export const LOCALE_STORAGE_KEY = "mlbox-locale";
export const DEFAULT_LOCALE: Locale = "en";

export const localeLabels: Record<Locale, string> = {
  en: "English",
  vi: "Tiếng Việt",
};

export function isLocale(value: unknown): value is Locale {
  return typeof value === "string" && (locales as readonly string[]).includes(value);
}

/** The stored choice wins; otherwise follow the browser language. */
export function detectLocale(stored: string | null, languages: readonly string[]): Locale {
  if (isLocale(stored)) return stored;
  return languages.some((language) => language.toLowerCase().startsWith("vi")) ? "vi" : DEFAULT_LOCALE;
}
