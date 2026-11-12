"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Cloud, DollarSign, LayoutDashboard, LogOut, Package, ScrollText, Server, Users, type LucideIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import BrandMark from "@/components/BrandMark";
import SettingsDrawer from "@/components/SettingsDrawer";
import { useSession } from "@/components/SessionProvider";

type NavItem = { href: string; key: "overview" | "sandboxes" | "users" | "audit" | "deployments" | "aws" | "cost"; icon: LucideIcon };

const NAV: NavItem[] = [
  { href: "/", key: "overview", icon: LayoutDashboard },
  { href: "/sandboxes/", key: "sandboxes", icon: Server },
  { href: "/users/", key: "users", icon: Users },
  { href: "/audit/", key: "audit", icon: ScrollText },
  { href: "/deployments/", key: "deployments", icon: Package },
  { href: "/aws/", key: "aws", icon: Cloud },
  { href: "/cost/", key: "cost", icon: DollarSign },
];

/** Same chrome as the dashboard: one navbar (brand, settings, account) with the page navigation underneath. */
export default function AppShell({ children }: { children: React.ReactNode }) {
  const t = useTranslations("nav");
  const pathname = usePathname();
  const { session, signOut } = useSession();
  const features = session.status === "authenticated" ? session.features : null;
  const user = session.status === "authenticated" ? session.user : "";

  const isCurrent = (href: string) => (href === "/" ? pathname === "/" : pathname.startsWith(href.replace(/\/$/, "")));

  return (
    <div className="workspace-frame">
      <header className="workspace-navbar">
        <Link href="/" className="workspace-brand" aria-label={t("home")}>
          <BrandMark />
          <span className="workspace-brand-copy">
            <strong>MLBox</strong>
            <span>{t("badge")}</span>
          </span>
        </Link>
        <div className="workspace-navbar-actions">
          <span className="workspace-account-email hidden sm:inline">{user}</span>
          <SettingsDrawer />
          <button type="button" className="workspace-navbar-icon-button" aria-label={t("logout")} title={t("logout")} onClick={() => void signOut()}>
            <LogOut aria-hidden="true" size={18} />
          </button>
        </div>
      </header>
      <div className="admin-body">
        <nav className="admin-sidebar" aria-label={t("label")}>
          {NAV.filter((item) => item.key !== "cost" || features?.costExplorer).map((item) => (
            <Link key={item.href} href={item.href} className={`admin-sidebar-link${isCurrent(item.href) ? " is-current" : ""}`} aria-current={isCurrent(item.href) ? "page" : undefined}>
              <item.icon aria-hidden="true" size={18} />
              {t(item.key)}
            </Link>
          ))}
        </nav>
        <main className="workspace-main workspace-enter">{children}</main>
      </div>
    </div>
  );
}
