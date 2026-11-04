"use client";

import { useTranslations } from "next-intl";
import { useActiveSpace } from "@/hooks/useActiveSpace";

export default function SpaceSwitcher() {
  const t = useTranslations("workspace");
  const { spaces, activeSpace, loading, failed, setActiveSpaceId } = useActiveSpace();

  if (loading) return <span className="workspace-muted-copy" role="status">{t("loadingSpaces")}</span>;
  if (failed || !activeSpace) {
    return <span className="workspace-muted-copy">{t("spacesUnavailable")}</span>;
  }

  return (
    <label className="workspace-space-context">
      <span className="workspace-eyebrow">{activeSpace.type === "personal" ? t("personalSpace") : t("organizationSpace")}</span>
      <span className="sr-only">{t("switchSpace")}</span>
      <select
        className="truncate text-sm font-medium"
        value={activeSpace.id}
        onChange={(event) => setActiveSpaceId(event.target.value)}
      >
        {spaces.map((space) => (
          <option key={space.id} value={space.id}>
            {space.name}
          </option>
        ))}
      </select>
    </label>
  );
}
