"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Button, Card, Spinner } from "@heroui/react";
import { ArrowLeft, RotateCcw } from "lucide-react";
import { useTranslations } from "next-intl";
import { bffFetch } from "@/lib/bffFetch";
import {
  type ProjectRecord,
} from "@/lib/projects";
import { useActiveSpace } from "@/hooks/useActiveSpace";
import ProjectArtifactsPanel from "@/components/ProjectArtifactsPanel";
import ProjectRuntimePanel from "@/components/ProjectRuntimePanel";
import CopyableText from "@/components/CopyableText";
import CardSectionTitle from "@/components/CardSectionTitle";
import ProjectDeleteButton from "@/components/ProjectDeleteButton";

export default function ProjectDetail({ projectId }: { projectId: string }) {
  const t = useTranslations("workspace");
  const [project, setProject] = useState<ProjectRecord | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<"unauthorized" | "unavailable" | null>(
    null,
  );

  const { spaces, loading: spacesLoading, failed: spacesFailed, reload: reloadSpaces } = useActiveSpace();
  // The name of the Space the Project belongs to, so the page shows a name instead of an id.
  const spaceName = useMemo(
    () => spaces.find((space) => space.id === project?.spaceId)?.name ?? null,
    [spaces, project?.spaceId],
  );

  const loadProject = useCallback(async () => {
    // The Project is loaded by its own id. The details page used to download the whole list of the
    // Space and pick the Project out of it, which grew with the Space.
    setLoading(true);
    setError(null);
    try {
      const response = await bffFetch(
        `/api/bff/projects/${encodeURIComponent(projectId)}`,
        { cache: "no-store" },
      );
      if (response.status === 401 || response.status === 403) {
        setError("unauthorized");
        return;
      }
      if (!response.ok) {
        setError("unavailable");
        return;
      }
      const body = (await response.json()) as { project?: ProjectRecord };
      setProject(body.project ?? null);
    } catch {
      setError("unavailable");
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    const task = window.setTimeout(() => void loadProject(), 0);
    return () => window.clearTimeout(task);
  }, [loadProject]);

  // The Project is loaded by its id, so the Spaces request is only needed for the name of the
  // Space. A failing Spaces request must not hide the Project itself.
  if (!spacesLoading && spacesFailed) {
    return (
      <DetailState
        title={t("unavailableTitle")}
        body={t("unavailableBody")}
        action={t("retry")}
        onAction={() => {
          reloadSpaces();
          void loadProject();
        }}
      />
    );
  }

  if (loading)
    return (
      <div className="flex items-center gap-2 text-sm" role="status">
        <Spinner size="sm" />
        <span>{t("loadingProjects")}</span>
      </div>
    );
  if (error === "unauthorized")
    return (
      <DetailState
        title={t("unauthorizedTitle")}
        body={t("unauthorizedBody")}
        action={t("backToProjects")}
        href="/projects"
      />
    );
  if (error === "unavailable")
    return (
      <DetailState
        title={t("unavailableTitle")}
        body={t("unavailableBody")}
        action={t("retry")}
        onAction={() => void loadProject()}
      />
    );
  if (!project)
    return (
      <DetailState
        title={t("projectNotFoundTitle")}
        body={t("projectNotFoundBody")}
        action={t("backToProjects")}
        href="/projects"
      />
    );

  return (
    <div className="flex flex-col gap-8">
      <div className="workspace-detail-back">
        <Link href="/projects" className="inline-flex items-center gap-1.5">
          <ArrowLeft aria-hidden="true" size={14} />
          {t("backToProjects")}
        </Link>
      </div>
      <header className="workspace-page-heading flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1>{project.name}</h1>
        </div>
        {project.canManage ? <ProjectDeleteButton projectId={project.id} projectName={project.name} /> : null}
      </header>

      <div className="workspace-detail-layout">
        <div className="workspace-detail-main">
          <Card>
            <Card.Header>
              <CardSectionTitle>{t("projectOverview")}</CardSectionTitle>
            </Card.Header>
            <Card.Content>
              <dl className="workspace-detail-facts">
                <div>
                  <dt>{t("projectId")}</dt>
                  <dd><CopyableText value={project.id} label={t("projectId")} /></dd>
                </div>
                <div>
                  <dt>{t("space")}</dt>
                  <dd>
                    {spaceName ? (
                      // The name of the Space, not its id: an id like "org:8751767b-…" means
                      // nothing to the user.
                      <span title={project.spaceId}>{spaceName}</span>
                    ) : (
                      t("space")
                    )}
                  </dd>
                </div>
              </dl>
            </Card.Content>
          </Card>
          <ProjectArtifactsPanel projectId={project.id} />
        </div>
        <aside
          className="workspace-detail-aside"
          aria-label={t("projectRuntimeAside")}>
          <ProjectRuntimePanel projectId={project.id} />
        </aside>
      </div>
    </div>
  );
}

function DetailState({
  title,
  body,
  action,
  href,
  onAction,
}: {
  title: string;
  body: string;
  action: string;
  href?: string;
  onAction?: () => void;
}) {
  return (
    <Card className="p-6" aria-live="polite">
      <h1>{title}</h1>
      <p>{body}</p>
      {href ? (
        <Link href={href}>
          <Button variant="secondary">
            <ArrowLeft aria-hidden="true" size={16} />
            {action}
          </Button>
        </Link>
      ) : (
        <Button variant="secondary" onPress={onAction}>
          <RotateCcw aria-hidden="true" size={16} />
          {action}
        </Button>
      )}
    </Card>
  );
}
