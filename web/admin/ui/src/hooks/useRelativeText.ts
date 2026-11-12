"use client";

import { useFormatter } from "next-intl";

/** "5 minutes ago" as a plain string in the language of the console, or null when there is no valid time. */
export function useRelativeText(value: string | null | undefined): string | null {
  const format = useFormatter();
  if (!value) return null;
  const time = new Date(value);
  if (Number.isNaN(time.getTime())) return null;
  return format.relativeTime(time, new Date());
}
