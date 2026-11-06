"use client";

import { useRouter, usePathname } from "next/navigation";
import { Tabs } from "@heroui/react";
import { useTranslations } from "next-intl";

const sections = [
  { href: "/account", key: "profile" },
  { href: "/account/subscription", key: "subscription" },
  { href: "/account/quota", key: "quota" },
] as const;

/** Switcher between the independent settings pages under /account. */
export default function AccountSubnav() {
  const t = useTranslations("account");
  const pathname = usePathname();
  const router = useRouter();
  const selected = [...sections].reverse().find(({ href }) => pathname === href || pathname.startsWith(`${href}/`))?.href ?? "/account";

  return (
    <Tabs
      selectedKey={selected}
      onSelectionChange={(key) => router.push(String(key))}
      aria-label={t("tabs.navigation")}
    >
      <Tabs.ListContainer>
        <Tabs.List>
          {sections.map(({ href, key }) => (
            <Tabs.Tab key={href} id={href}>
              {t(`tabs.${key}`)}
              <Tabs.Indicator />
            </Tabs.Tab>
          ))}
        </Tabs.List>
      </Tabs.ListContainer>
    </Tabs>
  );
}
