"use client";

import { useState } from "react";
import { Button } from "@heroui/react";
import { ExternalLink, Play } from "lucide-react";
import { useTranslations } from "next-intl";
import type { useProjectSandbox } from "@/hooks/useProjectSandbox";
import { openNotebookViaHandoff } from "@/lib/notebookHandoff";
import InstanceType from "@/components/InstanceType";
import FeedbackAlert from "@/components/FeedbackAlert";

type Sandbox = ReturnType<typeof useProjectSandbox>;

/**
 * The row's launch action. While running it opens the notebook; otherwise it starts the sandbox without a
 * profile, so the server launches the Project's last profile (or the default). While running, the instance
 * is shown under the Project name by ProjectRow, so this only shows the instance when it is stopped.
 */
export default function ProjectRuntimeControl({ sandbox }: { sandbox: Sandbox }) {
  const t = useTranslations("projectRuntime");
  const { data, loading, busy, error, stateKey, canOperate, profiles, preferredProfile, act } = sandbox;
  const url = data?.sandbox?.url ?? null;
  const running = stateKey === "running";
  const starting = stateKey === "starting";
  const [openFailed, setOpenFailed] = useState(false);

  const openNotebook = async () => {
    setOpenFailed(false);
    if (!url) return;
    if (!(await openNotebookViaHandoff(url))) setOpenFailed(true);
  };

  return (
    <div className="workspace-runtime">
      {!running && preferredProfile ? <InstanceType slug={preferredProfile} profiles={profiles} /> : null}
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
