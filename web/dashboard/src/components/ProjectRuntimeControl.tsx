"use client";

import { Button, Chip } from "@heroui/react";
import { ExternalLink, Play, Square } from "lucide-react";
import { useTranslations } from "next-intl";
import { useProjectSandbox } from "@/hooks/useProjectSandbox";
import { runtimeChipColor } from "@/lib/artifacts";

/**
 * Runtime state and controls for one Project row. One primary action per state:
 * "Open notebook" while running, "Start" otherwise. Stop is always secondary.
 */
export default function ProjectRuntimeControl({ projectId }: { projectId: string }) {
  const t = useTranslations("projectRuntime");
  const { data, loading, busy, error, stateKey, canOperate, act } = useProjectSandbox(projectId);
  const url = data?.sandbox?.url ?? null;
  const running = stateKey === "running";
  const starting = stateKey === "starting";
  const label = loading && !data ? t("loading") : error && !data ? t("loadFailed") : t(`state.${stateKey}`);

  return (
    <div className="workspace-runtime">
      <Chip size="sm" variant="soft" color={runtimeChipColor(stateKey)} aria-live="polite">{label}</Chip>
      {running && url ? (
        <Button size="sm" variant="primary" onPress={() => window.open(url, "_blank", "noopener")}>
          <ExternalLink aria-hidden="true" size={14} />
          {t("open")}
        </Button>
      ) : (
        <Button
          size="sm"
          variant="primary"
          isDisabled={busy || loading || !canOperate || running || starting}
          onPress={() => void act("start")}
        >
          <Play aria-hidden="true" size={14} />
          {t("start")}
        </Button>
      )}
      {running ? (
        <Button
          size="sm"
          variant="secondary"
          isDisabled={busy || loading || !canOperate}
          onPress={() => void act("stop")}
        >
          <Square aria-hidden="true" size={14} />
          {t("stop")}
        </Button>
      ) : null}
      {error && data ? <p className="workspace-form-error w-full" role="alert">{t(error)}</p> : null}
    </div>
  );
}
