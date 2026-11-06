"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Avatar, Dropdown } from "@heroui/react";
import { CreditCard, Gauge, LogOut, UserPen, Users } from "lucide-react";
import { useTranslations } from "next-intl";
import { bffFetch } from "@/lib/bffFetch";

type SessionBody = { user?: { email?: string } };

/** Avatar dropdown: profile, subscription, quota and sign-out. */
export default function AccountMenu() {
  const t = useTranslations("navbar");
  const tWorkspace = useTranslations("workspace");
  const router = useRouter();
  const [email, setEmail] = useState<string | null>(null);
  const [signingOut, setSigningOut] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const task = window.setTimeout(() => {
      bffFetch("/api/bff/auth/session", { cache: "no-store" })
        .then((response) => (response.ok ? response.json() as Promise<SessionBody> : null))
        .then((body) => {
          if (!cancelled && body?.user?.email) setEmail(body.user.email);
        })
        .catch(() => undefined);
    }, 0);
    return () => {
      cancelled = true;
      window.clearTimeout(task);
    };
  }, []);

  const initials = email ? email.slice(0, 2).toUpperCase() : "?";

  const signOut = async () => {
    setSigningOut(true);
    try {
      await bffFetch("/api/bff/auth/logout", { method: "POST" });
    } finally {
      router.push("/login");
      router.refresh();
    }
  };

  const onAction = (key: string | number) => {
    switch (String(key)) {
      case "profile":
        router.push("/account");
        break;
      case "teams":
        router.push("/teams");
        break;
      case "subscription":
        router.push("/account/subscription");
        break;
      case "quota":
        router.push("/account/quota");
        break;
      case "signout":
        void signOut();
        break;
    }
  };

  return (
    <Dropdown>
      <Dropdown.Trigger aria-label={t("accountMenu")} className="workspace-avatar-trigger" isDisabled={signingOut}>
        <Avatar size="sm">
          <Avatar.Fallback>{initials}</Avatar.Fallback>
        </Avatar>
      </Dropdown.Trigger>
      <Dropdown.Popover placement="bottom end">
        {email ? <div className="workspace-account-email">{email}</div> : null}
        <Dropdown.Menu aria-label={t("accountMenu")} onAction={onAction}>
          <Dropdown.Item id="profile" textValue={t("editProfile")}>
            <UserPen aria-hidden="true" size={16} />
            <span>{t("editProfile")}</span>
          </Dropdown.Item>
          <Dropdown.Item id="teams" textValue={t("teams")}>
            <Users aria-hidden="true" size={16} />
            <span>{t("teams")}</span>
          </Dropdown.Item>
          <Dropdown.Item id="subscription" textValue={t("subscription")}>
            <CreditCard aria-hidden="true" size={16} />
            <span>{t("subscription")}</span>
          </Dropdown.Item>
          <Dropdown.Item id="quota" textValue={t("quota")}>
            <Gauge aria-hidden="true" size={16} />
            <span>{t("quota")}</span>
          </Dropdown.Item>
          <Dropdown.Item id="signout" textValue={tWorkspace("signOut")} variant="danger">
            <LogOut aria-hidden="true" size={16} />
            <span>{tWorkspace("signOut")}</span>
          </Dropdown.Item>
        </Dropdown.Menu>
      </Dropdown.Popover>
    </Dropdown>
  );
}
