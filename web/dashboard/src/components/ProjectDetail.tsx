"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { Button } from "@heroui/react";
import { useTranslations } from "next-intl";
import { bffFetch } from "@/lib/bffFetch";
import { resolveProject, type ProjectListResponse, type ProjectRecord } from "@/lib/projects";
import { useActiveSpace } from "@/hooks/useActiveSpace";
import ProjectArtifactsPanel from "@/components/ProjectArtifactsPanel";
import ProjectRuntimePanel from "@/components/ProjectRuntimePanel";

export default function ProjectDetail({ projectId }: { projectId: string }) {
  const t = useTranslations("workspace");
  const [project, setProject] = useState<ProjectRecord | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<"unauthorized" | "unavailable" | null>(null);

  const { activeSpace } = useActiveSpace();
  const activeSpaceId = activeSpace?.id ?? null;

  const loadProject = useCallback(async () => {
    if (!activeSpaceId) return;
    setLoading(true);
    setError(null);
    try {
      const response = await bffFetch(`/api/bff/projects?spaceId=${encodeURIComponent(activeSpaceId)}`, { cache: "no-store" });
      if (response.status === 401 || response.status === 403) {
        setError("unauthorized");
        return;
      }
      if (!response.ok) {
        setError("unavailable");
        return;
      }
      const body = await response.json() as ProjectListResponse;
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

  if (loading) return <p className="muted" role="status">{t("loadingProjects")}</p>;
  if (error === "unauthorized") return <DetailState title={t("unauthorizedTitle")} body={t("unauthorizedBody")} action={t("backToProjects")} href="/projects" />;
  if (error === "unavailable") return <DetailState title={t("unavailableTitle")} body={t("unavailableBody")} action={t("retry")} onAction={() => void loadProject()} />;
  if (!project) return <DetailState title={t("projectNotFoundTitle")} body={t("projectNotFoundBody")} action={t("backToProjects")} href="/projects" />;

  return (
    <div className="page">
      <Link href="/projects" className="text-link">← {t("backToProjects")}</Link>
      <header className="page-header">
        <div className="page-header-text">
          <p className="page-kicker">{project.teamName || t("personalTeam")}</p>
          <h1 className="page-title">{project.name}</h1>
          <p className="page-lede">{t("projectOverviewBody")}</p>
        </div>
      </header>

      <section className="project-layout" aria-label={t("projectOverview")}>
        <div className="project-layout-main">
          <ProjectArtifactsPanel projectId={project.id} />
        </div>
        <aside className="project-layout-side">
          <ProjectRuntimePanel projectId={project.id} />
          <section className="panel">
            <h2 className="panel-title">{t("projectOverview")}</h2>
            <dl className="facts">
              <div><dt>{t("projectId")}</dt><dd>{project.id}</dd></div>
              <div><dt>{t("personalSpace")}</dt><dd>{project.spaceId || t("personalSpace")}</dd></div>
              <div><dt>{t("projectTeam")}</dt><dd>{project.teamName || t("personalTeam")}</dd></div>
            </dl>
          </section>
        </aside>
      </section>
    </div>
  );
}

function DetailState({ title, body, action, href, onAction }: { title: string; body: string; action: string; href?: string; onAction?: () => void }) {
  const t = useTranslations("workspace");

  return (
    <section className="empty" aria-live="polite">
      <h2>{title}</h2>
      <p>{body}</p>
      {href ? <Link href={href}><Button variant="secondary">{action}</Button></Link> : <Button variant="secondary" onPress={onAction}>{action}</Button>}
    </section>
  );
}
