"use client";

import { Button, Drawer, ToggleButton, ToggleButtonGroup } from "@heroui/react";
import { Monitor, Moon, SlidersHorizontal, Sun, X } from "lucide-react";
import { useTranslations } from "next-intl";
import { locales, localeLabels, type Locale } from "@/i18n/config";
import { useSetLocale } from "@/hooks/useSetLocale";
import { useTheme, type ThemeMode } from "@/hooks/useTheme";
import LocaleFlag from "@/components/LocaleFlag";

type Key = string | number;

function firstKey(keys: "all" | Iterable<Key>): Key | undefined {
  if (keys === "all") return undefined;
  for (const key of keys) return key;
  return undefined;
}

/** Interface settings drawer: language and light/dark display mode. */
export default function SettingsDrawer() {
  const t = useTranslations("navbar");
  const { current, isPending, setLocale } = useSetLocale();
  const { mode, setMode } = useTheme();

  const onLocale = (keys: "all" | Iterable<Key>) => {
    const key = firstKey(keys);
    if (key) setLocale(String(key) as Locale);
  };

  const onTheme = (keys: "all" | Iterable<Key>) => {
    const key = firstKey(keys);
    if (key === "light" || key === "dark" || key === "system") setMode(key as ThemeMode);
  };

  return (
    <Drawer>
      <Drawer.Trigger
        aria-label={t("openSettings")}
        className="workspace-navbar-icon-button"
      >
        <SlidersHorizontal aria-hidden="true" size={18} />
      </Drawer.Trigger>
      <Drawer.Backdrop isDismissable={false} variant="blur">
        <Drawer.Content placement="right">
          <Drawer.Dialog aria-label={t("settingsTitle")}>
            {({ close }) => (
              <>
                <Drawer.Header>
                  <div className="flex w-full items-center justify-between gap-4">
                    <Drawer.Heading>{t("settingsTitle")}</Drawer.Heading>
                    <Button
                      isIconOnly
                      variant="tertiary"
                      size="sm"
                      aria-label={t("closeSettings")}
                      onPress={close}
                    >
                      <X aria-hidden="true" size={16} />
                    </Button>
                  </div>
                </Drawer.Header>
                <Drawer.Body className="flex flex-col gap-8">
                  <section className="workspace-settings-section">
                    <h3 className="workspace-mono-label">{t("language")}</h3>
                    <ToggleButtonGroup
                      fullWidth
                      selectionMode="single"
                      disallowEmptySelection
                      selectedKeys={[current]}
                      onSelectionChange={onLocale}
                      aria-label={t("language")}
                    >
                      {locales.map((loc) => (
                        <ToggleButton key={loc} id={loc} isDisabled={isPending}>
                          <LocaleFlag locale={loc} className="h-3.5 w-5" />
                          <span>{localeLabels[loc]}</span>
                        </ToggleButton>
                      ))}
                    </ToggleButtonGroup>
                  </section>
                  <section className="workspace-settings-section">
                    <h3 className="workspace-mono-label">{t("theme")}</h3>
                    <ToggleButtonGroup
                      fullWidth
                      selectionMode="single"
                      disallowEmptySelection
                      selectedKeys={[mode]}
                      onSelectionChange={onTheme}
                      aria-label={t("theme")}
                    >
                      <ToggleButton id="system">
                        <Monitor aria-hidden="true" size={16} />
                        <span>{t("themeSystem")}</span>
                      </ToggleButton>
                      <ToggleButton id="light">
                        <Sun aria-hidden="true" size={16} />
                        <span>{t("themeLight")}</span>
                      </ToggleButton>
                      <ToggleButton id="dark">
                        <Moon aria-hidden="true" size={16} />
                        <span>{t("themeDark")}</span>
                      </ToggleButton>
                    </ToggleButtonGroup>
                  </section>
                </Drawer.Body>
              </>
            )}
          </Drawer.Dialog>
        </Drawer.Content>
      </Drawer.Backdrop>
    </Drawer>
  );
}
