"use client";

import { Dropdown } from "@heroui/react";
import { useTranslations } from "next-intl";
import { Check, ChevronDown } from "lucide-react";
import { locales, localeLabels } from "@/i18n/config";
import { useSetLocale } from "@/hooks/useSetLocale";
import LocaleFlag from "@/components/LocaleFlag";

/**
 * Language dropdown used on the public landing page. The trigger is the
 * Dropdown.Trigger itself (HeroUI renders it as the button) — do not nest a
 * Button inside it.
 */
export default function LocaleSwitcher() {
  const t = useTranslations("navbar");
  const { current, isPending, setLocale } = useSetLocale();

  return (
    <Dropdown>
      <Dropdown.Trigger
        className="workspace-locale-trigger"
        isDisabled={isPending}
        aria-label={localeLabels[current]}
      >
        <LocaleFlag locale={current} className="h-3.5 w-5" />
        <span className="workspace-locale-label">{localeLabels[current]}</span>
        <ChevronDown aria-hidden="true" size={14} />
      </Dropdown.Trigger>
      <Dropdown.Popover placement="top end">
        <Dropdown.Menu
          aria-label={t("language")}
          selectionMode="single"
          selectedKeys={[current]}
          onAction={(key) => setLocale(String(key) as typeof current)}
        >
          {locales.map((loc) => (
            <Dropdown.Item key={loc} id={loc} textValue={localeLabels[loc]}>
              <LocaleFlag locale={loc} className="h-3.5 w-5" />
              <span>{localeLabels[loc]}</span>
              {loc === current ? <Check aria-hidden="true" size={14} className="ml-auto" /> : null}
            </Dropdown.Item>
          ))}
        </Dropdown.Menu>
      </Dropdown.Popover>
    </Dropdown>
  );
}
