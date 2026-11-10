"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Avatar, Chip, Dropdown, Label, Separator } from "@heroui/react";
import { CreditCard, Gauge, LogOut, ShieldCheck, UserPen, Users } from "lucide-react";
import { useTranslations } from "next-intl";
import { bffFetch } from "@/lib/bffFetch";
import { initialsFor, type AccountProfile } from "@/lib/account";
import { useActiveSpace } from "@/hooks/useActiveSpace";

type ProfileBody = { profile?: AccountProfile };

// Owner stands out, admin is positive, member and viewer stay neutral.
const ROLE_CHIP_COLOR = {
  owner: "accent",
  admin: "success",
  member: "default",
  viewer: "default",
} as const;

/** Avatar dropdown: avatar, full name and email at the top, then teams, subscription, quota and sign-out. */
export default function AccountMenu() {
  const t = useTranslations("navbar");
  const tWorkspace = useTranslations("workspace");
  const router = useRouter();
  const { activeSpace } = useActiveSpace();
  const [profile, setProfile] = useState<AccountProfile | null>(null);
  const [signingOut, setSigningOut] = useState(false);
  // Teams manage an organization; a personal Space has none.
  const showTeams = activeSpace?.type === "organization";

  useEffect(() => {
    let cancelled = false;
    const task = window.setTimeout(() => {
      bffFetch("/api/bff/account/profile", { cache: "no-store" })
        .then((response) => (response.ok ? response.json() as Promise<ProfileBody> : null))
        .then((body) => {
          if (!cancelled && body?.profile) setProfile(body.profile);
        })
        .catch(() => undefined);
    }, 0);
    return () => {
      cancelled = true;
      window.clearTimeout(task);
    };
  }, []);

  const email = profile?.email ?? null;
  const initials = profile ? initialsFor(profile) : "?";

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
        router.push("/subscription");
        break;
      case "quota":
        router.push("/quota");
        break;
      case "security":
        router.push("/security");
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
          {profile?.avatarDataUrl ? <Avatar.Image src={profile.avatarDataUrl} alt="" /> : null}
          <Avatar.Fallback>{initials}</Avatar.Fallback>
        </Avatar>
      </Dropdown.Trigger>
      <Dropdown.Popover placement="bottom end">
        {profile ? (
          // px-4 = the menu's own padding (6px) plus each item's inline padding (10px), so the header lines up with the items.
          <div className="flex min-w-0 items-center gap-3 px-4 py-3">
            <Avatar size="md">
              {profile.avatarDataUrl ? <Avatar.Image src={profile.avatarDataUrl} alt="" /> : null}
              <Avatar.Fallback>{initials}</Avatar.Fallback>
            </Avatar>
            <div className="flex min-w-0 flex-col">
              <span className="truncate text-sm font-medium">{profile.fullName ?? email}</span>
              {profile.fullName && email ? <span className="truncate text-xs" style={{ color: "var(--muted)" }}>{email}</span> : null}
            </div>
          </div>
        ) : email ? <div className="px-4 py-3 text-xs" style={{ color: "var(--muted)" }}>{email}</div> : null}
        <Separator />
        <Dropdown.Menu aria-label={t("accountMenu")} onAction={onAction}>
          <Dropdown.Section>
            <Dropdown.Item id="profile" textValue={t("editProfile")}>
              <UserPen aria-hidden="true" size={16} className="shrink-0 text-muted" />
              <Label className="leading-none">{t("editProfile")}</Label>
            </Dropdown.Item>
            {showTeams ? (
              <Dropdown.Item id="teams" textValue={t("teams")}>
                <Users aria-hidden="true" size={16} className="shrink-0 text-muted" />
                <Label className="leading-none">{t("teams")}</Label>
                {activeSpace?.role ? (
                  <Chip size="sm" variant="soft" color={ROLE_CHIP_COLOR[activeSpace.role]} className="ml-auto">{t(`roles.${activeSpace.role}`)}</Chip>
                ) : null}
              </Dropdown.Item>
            ) : null}
          </Dropdown.Section>
          <Separator />
          <Dropdown.Section>
            <Dropdown.Item id="subscription" textValue={t("subscription")}>
              <CreditCard aria-hidden="true" size={16} className="shrink-0 text-muted" />
              <Label className="leading-none">{t("subscription")}</Label>
            </Dropdown.Item>
            <Dropdown.Item id="quota" textValue={t("quota")}>
              <Gauge aria-hidden="true" size={16} className="shrink-0 text-muted" />
              <Label className="leading-none">{t("quota")}</Label>
            </Dropdown.Item>
            <Dropdown.Item id="security" textValue={t("security")}>
              <ShieldCheck aria-hidden="true" size={16} className="shrink-0 text-muted" />
              <Label className="leading-none">{t("security")}</Label>
            </Dropdown.Item>
          </Dropdown.Section>
          <Separator />
          <Dropdown.Section>
            <Dropdown.Item id="signout" textValue={tWorkspace("signOut")} variant="danger">
              <LogOut aria-hidden="true" size={16} className="shrink-0 text-danger" />
              <Label className="leading-none">{tWorkspace("signOut")}</Label>
          </Dropdown.Item>
          </Dropdown.Section>
        </Dropdown.Menu>
      </Dropdown.Popover>
    </Dropdown>
  );
}
