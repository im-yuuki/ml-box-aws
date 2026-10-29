import { useTranslations } from "next-intl";

export default function SpaceContext() {
  const t = useTranslations("workspace");

  return (
    <div className="workspace-space-context" aria-label={t("personalSpaceLabel")}>
      <span className="workspace-space-mark" aria-hidden="true">P</span>
      <span className="flex min-w-0 flex-col">
        <span className="workspace-eyebrow">{t("personalSpace")}</span>
        <span className="truncate text-sm font-medium">{t("spaceType")}</span>
      </span>
    </div>
  );
}
