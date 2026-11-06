"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { Button, Card, Spinner } from "@heroui/react";
import { ArrowLeft, RotateCcw } from "lucide-react";
import { useTranslations } from "next-intl";
import { bffFetch } from "@/lib/bffFetch";
import {
  resolveProject,
  type ProjectListResponse,
  type ProjectRecord,
} from "@/lib/projects";
import { useActiveSpace } from "@/hooks/useActiveSpace";
import ProjectArtifactsPanel from "@/components/ProjectArtifactsPanel";
import ProjectRuntimePanel from "@/components/ProjectRuntimePanel";

export default function ProjectDetail({ projectId }: { projectId: string }) {
  const t = useTranslations("workspace");
  const [project, setProject] = useState<ProjectRecord | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<"unauthorized" | "unavailable" | null>(
    null,
  );

  const { activeSpace } = useActiveSpace();
  const activeSpaceId = activeSpace?.id ?? null;

  const loadProject = useCallback(async () => {
    if (!activeSpaceId) return;
    setLoading(true);
    setError(null);
    try {
      const response = await bffFetch(
        `/api/bff/projects?spaceId=${encodeURIComponent(activeSpaceId)}`,
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
      const body = (await response.json()) as ProjectListResponse;
      setProject(resolveProject(body.projects ?? [], projectId));
    } catch {
      setError("unavailable");
    } finally {
      setLoading(false);
    }
  }, [projectId, activeSpaceId]);

  useEffect(() => {
    const task = window.setTimeout(() => void loadProject(), 0);
    return () => window.clearTimeout(task);
  }, [loadProject]);

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
      <header className="workspace-page-heading">
        <div>
          <h1>{project.name}</h1>
        </div>
      </header>

      <div className="workspace-detail-layout">
        <div className="workspace-detail-main">
          <Card>
            <Card.Header>
              <Card.Title>{t("projectOverview")}</Card.Title>
            </Card.Header>
            <Card.Content>
              <dl className="workspace-detail-facts">
                <div>
                  <dt>{t("projectId")}</dt>
                  <dd>{project.id}</dd>
                </div>
                <div>
                  <dt>{t("personalSpace")}</dt>
                  <dd>{project.spaceId || t("personalSpace")}</dd>
                </div>
                <div>
                  <dt>{t("projectTeam")}</dt>
                  <dd>{project.teamName || t("personalTeam")}</dd>
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
