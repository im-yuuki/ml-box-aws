"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@heroui/react";
import { useTranslations } from "next-intl";
import LocaleSwitcher from "@/components/LocaleSwitcher";
import SpaceSwitcher from "@/components/SpaceSwitcher";
import ThemeToggle from "@/components/ThemeToggle";
import { bffFetch } from "@/lib/bffFetch";
import { getWorkspaceNavigation } from "@/lib/workspace-nav";

const icons: Record<string, string> = {
  "/projects": "▦",
  "/teams": "◈",
  "/usage": "⌁",
  "/account": "◎",
};

export default function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const tNav = useTranslations("nav");
  const tWorkspace = useTranslations("workspace");
  const tCommon = useTranslations("common");
  const [menuOpen, setMenuOpen] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const items = getWorkspaceNavigation(pathname);
  const labels = {
    "/projects": tNav("projects"),
    "/teams": tNav("teams"),
    "/usage": tNav("usage"),
    "/account": tNav("account"),
  } as const;

  const signOut = async () => {
    setSigningOut(true);
    let hubLogoutUrl: string | null = null;
    try {
      const response = await bffFetch("/api/bff/auth/logout", { method: "POST" });
      const body = await response.json().catch(() => ({})) as { hubLogoutUrl?: string | null };
      hubLogoutUrl = body.hubLogoutUrl ?? null;
    } finally {
      if (hubLogoutUrl) {
        // Full navigation: the Hub logout clears its cookie on the notebook host and ends on the login page.
        window.location.href = hubLogoutUrl;
        return;
      }
      router.push("/login");
      router.refresh();
    }
  };

  const navigation = (
    <nav className="workspace-nav" aria-label={tWorkspace("workspaceNavigation")}>
      {items.map((item) => (
        <Link
          key={item.href}
          href={item.href}
          className={`workspace-nav-link${item.current ? " is-current" : ""}`}
          aria-current={item.current ? "page" : undefined}
          onClick={() => setMenuOpen(false)}
        >
          <span className="workspace-nav-icon" aria-hidden="true">{icons[item.href]}</span>
          <span>{labels[item.href]}</span>
        </Link>
      ))}
    </nav>
  );

  return (
    <div className="workspace-frame">
      <aside className="workspace-rail" aria-label={tWorkspace("workspaceNavigation")}>
        <Link href="/" className="workspace-brand" aria-label={tWorkspace("homeLink")}>
          <span className="workspace-brand-mark" aria-hidden="true">M</span>
          <span className="workspace-brand-copy">
            <strong>ML Box</strong>
            <span>{tWorkspace("workspaceLabel")}</span>
          </span>
        </Link>
        <SpaceSwitcher />
        {navigation}
        <div className="workspace-rail-footer">
          <LocaleSwitcher />
          <ThemeToggle />
          <Button
            type="button"
            variant="tertiary"
            size="sm"
            className="workspace-signout"
            isDisabled={signingOut}
            onPress={() => void signOut()}
          >
            <span aria-hidden="true">↗</span>
            <span>{tWorkspace("signOut")}</span>
          </Button>
        </div>
      </aside>

      <div className="workspace-content">
        <header className="workspace-header">
          <div className="workspace-mobile-bar">
            <Link href="/" className="workspace-brand workspace-brand-mobile" aria-label={tWorkspace("homeLink")}>
              <span className="workspace-brand-mark" aria-hidden="true">M</span>
              <span className="workspace-brand-copy"><strong>{tCommon("appName")}</strong><span>{tWorkspace("workspaceLabel")}</span></span>
            </Link>
            <Button
              type="button"
              variant="tertiary"
              size="sm"
              className="workspace-menu-button"
              aria-expanded={menuOpen}
              aria-controls="workspace-mobile-nav"
              aria-label={menuOpen ? tWorkspace("closeMenu") : tWorkspace("menu")}
              onPress={() => setMenuOpen((open) => !open)}
            >
              <span aria-hidden="true">{menuOpen ? "×" : "☰"}</span>
            </Button>
          </div>
          <div className="workspace-header-context">
            <span className="workspace-header-kicker">{tWorkspace("personalSpace")}</span>
            <span className="workspace-header-title">{tWorkspace("spaceType")}</span>
          </div>
          <div className="workspace-header-actions">
            <LocaleSwitcher />
            <ThemeToggle />
            <Link href="/account" className="workspace-account-link">{tNav("account")}</Link>
          </div>
        </header>
        {menuOpen ? <div id="workspace-mobile-nav" className="workspace-mobile-nav">{navigation}</div> : null}
        <main className="workspace-main workspace-enter">{children}</main>
      </div>
    </div>
  );
}
