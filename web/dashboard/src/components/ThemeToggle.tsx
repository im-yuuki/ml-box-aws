"use client";

import { useEffect, useState } from "react";
import { Button } from "@heroui/react";
import { useTranslations } from "next-intl";

function getTheme(): "light" | "dark" {
  if (typeof document === "undefined") return "light";
  return document.documentElement.dataset.theme === "dark" ? "dark" : "light";
}

export default function ThemeToggle() {
  const t = useTranslations("workspace");
  const [theme, setTheme] = useState<"light" | "dark">("light");

  useEffect(() => {
    const task = window.setTimeout(() => setTheme(getTheme()), 0);
    return () => window.clearTimeout(task);
  }, []);

  const toggleTheme = () => {
    const next = theme === "dark" ? "light" : "dark";
    document.documentElement.dataset.theme = next;
    localStorage.setItem("mlbox-theme", next);
    setTheme(next);
  };

  return (
    <Button
      type="button"
      variant="tertiary"
      size="sm"
      className="workspace-icon-button"
      aria-label={t("toggleTheme")}
      onPress={toggleTheme}
    >
      <span aria-hidden="true" className="text-base">{theme === "dark" ? "☼" : "◐"}</span>
    </Button>
  );
}
