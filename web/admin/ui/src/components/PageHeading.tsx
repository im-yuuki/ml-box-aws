"use client";

import { Button } from "@heroui/react";
import { RefreshCw } from "lucide-react";
import { useTranslations } from "next-intl";

/** The heading every page starts with: kicker, h1, one line of explanation and the refresh action. */
export default function PageHeading({
  eyebrow,
  title,
  subtitle,
  onRefresh,
  loading = false,
}: {
  eyebrow: string;
  title: string;
  subtitle: string;
  onRefresh?: () => void;
  loading?: boolean;
}) {
  const t = useTranslations("common");
  return (
    <header className="workspace-page-heading">
      <div>
        <p className="workspace-eyebrow">{eyebrow}</p>
        <h1>{title}</h1>
        <p>{subtitle}</p>
      </div>
      {onRefresh ? (
        <Button variant="tertiary" onPress={onRefresh} isPending={loading} isDisabled={loading}>
          <RefreshCw aria-hidden="true" size={16} />
          {t("refresh")}
        </Button>
      ) : null}
    </header>
  );
}
