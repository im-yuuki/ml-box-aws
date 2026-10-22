import Link from "next/link";
import type { ReactNode } from "react";
import { getTranslations } from "next-intl/server";
import LocaleSwitcher from "@/components/LocaleSwitcher";

/**
 * App shell for authenticated pages (sandboxes, usage, account).
 *
 * The nav and switcher are server-rendered; the user menu can be hydrated
 * later once the BFF exposes the session endpoint.
 */
export default async function AppLayout({ children }: { children: ReactNode }) {
  const tNav = await getTranslations("nav");
  const tCommon = await getTranslations("common");
  const navItems = [
    { href: "/sandboxes", label: tNav("sandboxes") },
    { href: "/usage", label: tNav("usage") },
    { href: "/account", label: tNav("account") },
  ] as const;

  return (
    <div className="flex flex-1 flex-col">
      <header
        className="border-b"
        style={{ borderColor: "var(--border)", background: "var(--surface)" }}
      >
        <div className="mx-auto flex max-w-5xl items-center justify-between px-6 py-3">
          <div className="flex items-center gap-6">
            <Link
              href="/"
              className="text-sm font-semibold tracking-tight"
              style={{ color: "var(--foreground)" }}
            >
              {tCommon("appName")}
            </Link>
            <nav className="flex items-center gap-1 text-sm">
              {navItems.map((item) => (
                <Link
                  key={item.href}
                  href={item.href}
                  className="rounded-md px-2 py-1 hover:opacity-80"
                  style={{ color: "var(--muted)" }}
                >
                  {item.label}
                </Link>
              ))}
            </nav>
          </div>
          <LocaleSwitcher />
        </div>
      </header>
      <div className="mx-auto w-full max-w-5xl flex-1 px-6 py-8">
        {children}
      </div>
    </div>
  );
}
