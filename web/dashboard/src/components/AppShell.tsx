"use client";

import Link from "next/link";
import { Boxes } from "lucide-react";
import { useTranslations } from "next-intl";
import AccountMenu from "@/components/navbar/AccountMenu";
import NavbarSearch from "@/components/navbar/NavbarSearch";
import SettingsDrawer from "@/components/navbar/SettingsDrawer";
import SpaceSwitcher from "@/components/navbar/SpaceSwitcher";

/**
 * Workspace chrome: one navbar (logo, workspace switcher, search, interface
 * settings, account menu) above the single workspace page.
 */
export default function AppShell({ children }: { children: React.ReactNode }) {
  const tWorkspace = useTranslations("workspace");

  return (
    <div className="workspace-frame">
      <header className="workspace-navbar">
        <Link href="/projects" className="workspace-brand" aria-label={tWorkspace("homeLink")}>
          <span className="workspace-brand-mark" aria-hidden="true"><Boxes size={18} strokeWidth={2} /></span>
          <span className="workspace-brand-copy">
            <strong>ML Box</strong>
          </span>
        </Link>
        <SpaceSwitcher />
        <NavbarSearch />
        <div className="workspace-navbar-actions">
          <SettingsDrawer />
          <AccountMenu />
        </div>
      </header>

      <main className="workspace-main workspace-enter">{children}</main>
    </div>
  );
}
