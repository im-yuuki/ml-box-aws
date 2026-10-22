import { cookies } from "next/headers";
import { getRequestConfig } from "next-intl/server";
import {
  DEFAULT_LOCALE,
  LOCALE_COOKIE,
  isLocale,
  type Locale,
} from "./config";
import en from "../messages/en.json";
import vi from "../messages/vi.json";

const messages: Record<Locale, typeof en> = { en, vi };

/**
 * Locale resolution for server components / route handlers.
 *
 * Order:
 *   1. cookie `mlbox-locale` (set by the locale switcher)
 *   2. fallback DEFAULT_LOCALE
 *
 * No URL-based routing per the chosen design (cookie only).
 */
export default getRequestConfig(async () => {
  const cookieStore = await cookies();
  const cookie = cookieStore.get(LOCALE_COOKIE)?.value;
  const locale: Locale = isLocale(cookie) ? cookie : DEFAULT_LOCALE;

  return { locale, messages: messages[locale] };
});
