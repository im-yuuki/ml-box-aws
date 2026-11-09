"use client";

import { useEffect, useRef, useState } from "react";
import { Button } from "@heroui/react";
import { Check, Copy } from "lucide-react";
import { useTranslations } from "next-intl";

/**
 * A value in a bordered block with a copy button. HeroUI v3 has no copy component, so this uses the
 * Clipboard API directly.
 */
export default function CopyableText({ value, label }: { value: string; label: string }) {
  const t = useTranslations("workspace");
  const [copied, setCopied] = useState(false);
  const timer = useRef<number | null>(null);

  useEffect(() => () => {
    if (timer.current !== null) window.clearTimeout(timer.current);
  }, []);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      if (timer.current !== null) window.clearTimeout(timer.current);
      timer.current = window.setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard access can be refused by the browser; the value stays selectable on the page.
    }
  };

  return (
    <div
      className="flex items-center justify-between gap-2 rounded-md border px-3 py-2"
      style={{ borderColor: "var(--border)" }}>
      <code className="min-w-0 truncate text-xs" aria-label={label}>{value}</code>
      <Button
        isIconOnly
        size="sm"
        variant="ghost"
        aria-label={copied ? t("copied") : t("copy")}
        onPress={() => void copy()}>
        {copied ? <Check aria-hidden="true" size={14} /> : <Copy aria-hidden="true" size={14} />}
      </Button>
    </div>
  );
}
