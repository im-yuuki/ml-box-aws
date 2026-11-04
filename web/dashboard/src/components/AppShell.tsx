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

// Layout v2: one top bar (brand, sections, space and preferences) above a centred content column.
// No side rail: the sections are a single row that scrolls on small screens.
export default function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const tNav = useTranslations("nav");
  const tWorkspace = useTranslations("workspace");
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

  return (
    <div className="workspace-frame">
      <header className="workspace-topbar">
        <div className="workspace-topbar-row">
          <Link href="/" className="workspace-brand" aria-label={tWorkspace("homeLink")}>
            <span className="workspace-brand-mark" aria-hidden="true">M</span>
            <span className="workspace-brand-copy">
              <strong>ML Box</strong>
            </span>
          </Link>
          <nav className="workspace-nav" aria-label={tWorkspace("workspaceNavigation")}>
            {items.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className={`workspace-nav-link${item.current ? " is-current" : ""}`}
                aria-current={item.current ? "page" : undefined}
              >
                {labels[item.href]}
              </Link>
            ))}
          </nav>
          <div className="workspace-topbar-actions">
            <SpaceSwitcher />
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
              {tWorkspace("signOut")}
            </Button>
          </div>
        </div>
      </header>

      <main className="workspace-main workspace-enter">{children}</main>
    </div>
  );
}
