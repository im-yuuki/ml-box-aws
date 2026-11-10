"use client";

import { useState } from "react";
import { Button } from "@heroui/react";
import { ExternalLink, Play } from "lucide-react";
import { useTranslations } from "next-intl";
import { useProjectSandbox } from "@/hooks/useProjectSandbox";
import { openNotebookViaHandoff } from "@/lib/notebookHandoff";
import InstanceType from "@/components/InstanceType";
import FeedbackAlert from "@/components/FeedbackAlert";

/**
 * The row's instance type and its single action. While running the action opens the notebook; otherwise
 * it starts the sandbox without a profile, so the server launches the Project's last profile (or the default).
 */
export default function ProjectRuntimeControl({ projectId }: { projectId: string }) {
  const t = useTranslations("projectRuntime");
  const { data, loading, busy, error, stateKey, canOperate, profiles, runningProfile, preferredProfile, act } = useProjectSandbox(projectId);
  const url = data?.sandbox?.url ?? null;
  const running = stateKey === "running";
  const starting = stateKey === "starting";
  const slug = running ? runningProfile : preferredProfile;
  const [openFailed, setOpenFailed] = useState(false);

  const openNotebook = async () => {
    setOpenFailed(false);
    if (!url) return;
    if (!(await openNotebookViaHandoff(url))) setOpenFailed(true);
  };

  return (
    <div className="workspace-runtime">
      {slug ? <InstanceType slug={slug} profiles={profiles} /> : null}
      {running && url ? (
        <Button size="sm" variant="secondary" onPress={() => void openNotebook()}>
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
      {error && data ? <div className="w-full"><FeedbackAlert status="danger">{t(error)}</FeedbackAlert></div> : null}
      {openFailed ? <div className="w-full"><FeedbackAlert status="danger">{t("openFailed")}</FeedbackAlert></div> : null}
    </div>
  );
}
