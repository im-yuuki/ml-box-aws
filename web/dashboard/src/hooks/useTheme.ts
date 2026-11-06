"use client";

import { useCallback, useEffect, useState } from "react";

/** What the user chose: a fixed mode, or follow the device setting. */
export type ThemeMode = "light" | "dark" | "system";
/** What is actually applied to the page. */
export type Theme = "light" | "dark";

export const THEME_STORAGE_KEY = "mlbox-theme";

const DARK_QUERY = "(prefers-color-scheme: dark)";

function readMode(): ThemeMode {
  try {
    const stored = localStorage.getItem(THEME_STORAGE_KEY);
    return stored === "light" || stored === "dark" ? stored : "system";
  } catch {
    return "system";
  }
}

function resolve(mode: ThemeMode): Theme {
  if (mode !== "system") return mode;
  return window.matchMedia(DARK_QUERY).matches ? "dark" : "light";
}

function apply(theme: Theme) {
  document.documentElement.dataset.theme = theme;
}

/**
 * Light, dark, or follow the device. The inline bootstrap script in the root
 * layout applies the stored choice before paint; this hook keeps React state
 * in sync and follows OS changes while the mode is "system".
 */
export function useTheme() {
  const [mode, setModeState] = useState<ThemeMode>("system");
  const [theme, setThemeState] = useState<Theme>("light");

  useEffect(() => {
    const task = window.setTimeout(() => {
      const current = readMode();
      setModeState(current);
      setThemeState(resolve(current));
    }, 0);
    return () => window.clearTimeout(task);
  }, []);

  useEffect(() => {
    if (mode !== "system") return;
    const query = window.matchMedia(DARK_QUERY);
    const onChange = () => {
      const next = resolve("system");
      apply(next);
      setThemeState(next);
    };
    query.addEventListener("change", onChange);
    return () => query.removeEventListener("change", onChange);
  }, [mode]);

  const setMode = useCallback((next: ThemeMode) => {
    const resolved = resolve(next);
    apply(resolved);
    try {
      localStorage.setItem(THEME_STORAGE_KEY, next);
    } catch {
      // Storage may be unavailable (private mode); the choice still applies for this page.
    }
    setModeState(next);
    setThemeState(resolved);
  }, []);

  return { mode, theme, setMode };
}
