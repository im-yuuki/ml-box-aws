"use client";

import { useTranslations } from "next-intl";
import { bffErrorKey, type BffErrorBody } from "@/lib/bffError";

/**
 * Turns a failed BFF response into a message in the user's language. The server message is only
 * used when the error code is unknown, so an English UI never shows a Vietnamese sentence.
 */
export function useBffErrorMessage() {
  const t = useTranslations("bffErrors");
  return async (response: Response, fallback: string): Promise<string> => {
    try {
      const body = (await response.json()) as BffErrorBody;
      const key = bffErrorKey(body);
      return key ? t(key) : fallback;
    } catch {
      return fallback;
    }
  };
}
