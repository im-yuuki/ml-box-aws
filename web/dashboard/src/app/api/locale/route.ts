import { NextResponse, type NextRequest } from "next/server";
import { LOCALE_COOKIE, isLocale } from "@/i18n/config";

/**
 * Persist the chosen locale in a cookie so the next server render
 * picks it up via getRequestConfig in `i18n/request.ts`.
 *
 * Accepts a POST with a JSON body `{ "locale": "en" | "vi" }`. The cookie
 * is set with no expiry (effectively the session lifetime) and SameSite=Lax
 * so the navigation back from a login redirect still carries the locale.
 */
export async function POST(request: NextRequest) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }
  const locale =
    typeof body === "object" && body !== null && "locale" in body
      ? (body as { locale: unknown }).locale
      : undefined;
  if (!isLocale(locale)) {
    return NextResponse.json({ error: "invalid_locale" }, { status: 400 });
  }

  const res = NextResponse.json({ ok: true, locale });
  res.cookies.set(LOCALE_COOKIE, locale, {
    path: "/",
    sameSite: "lax",
    // 1 year — the user can change again any time via the switcher.
    maxAge: 60 * 60 * 24 * 365,
  });
  return res;
}
