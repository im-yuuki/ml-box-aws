import { Card } from "@heroui/react";
import type { ReactNode } from "react";
import Link from "next/link";
import { Boxes } from "lucide-react";
import LocaleSwitcher from "@/components/LocaleSwitcher";

/** Shared frame for sign-in and sign-up: brand, a single card, and the language switch. */
export default function AuthShell({
  title,
  subtitle,
  appName,
  homeLabel,
  children,
  footer,
}: {
  title: string;
  subtitle?: string;
  appName: string;
  homeLabel: string;
  children: ReactNode;
  footer?: ReactNode;
}) {
  return (
    <div className="public-frame">
      <header className="public-header">
        <Link href="/" className="workspace-brand" aria-label={homeLabel}>
          <span className="workspace-brand-mark" aria-hidden="true"><Boxes size={18} strokeWidth={2} /></span>
          <span className="workspace-brand-copy"><strong>{appName}</strong></span>
        </Link>
        <LocaleSwitcher />
      </header>
      <main className="public-main">
        <Card className="auth-card" aria-labelledby="auth-title">
          <h1 id="auth-title">{title}</h1>
          {subtitle ? <p className="auth-sub">{subtitle}</p> : null}
          {children}
          {footer ? <div className="auth-footer">{footer}</div> : null}
        </Card>
      </main>
    </div>
  );
}
