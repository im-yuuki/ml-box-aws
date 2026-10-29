"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { Button, Card } from "@heroui/react";
import { useTranslations } from "next-intl";
import { bffFetch } from "@/lib/bffFetch";
import { resolveProject, type ProjectListResponse, type ProjectRecord } from "@/lib/projects";

export default function ProjectDetail({ projectId }: { projectId: string }) {
  const t = useTranslations("workspace");
  const [project, setProject] = useState<ProjectRecord | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<"unauthorized" | "unavailable" | null>(null);

  const loadProject = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await bffFetch("/api/bff/projects", { cache: "no-store" });
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
  }, [projectId]);

  useEffect(() => {
    const task = window.setTimeout(() => void loadProject(), 0);
    return () => window.clearTimeout(task);
  }, [loadProject]);

  if (loading) return <p className="workspace-muted-copy" role="status">{t("loadingProjects")}</p>;
  if (error === "unauthorized") return <DetailState title={t("unauthorizedTitle")} body={t("unauthorizedBody")} action={t("backToProjects")} href="/projects" />;
  if (error === "unavailable") return <DetailState title={t("unavailableTitle")} body={t("unavailableBody")} action={t("retry")} onAction={() => void loadProject()} />;
  if (!project) return <DetailState title={t("projectNotFoundTitle")} body={t("projectNotFoundBody")} action={t("backToProjects")} href="/projects" />;

  return (
    <div className="flex flex-col gap-8">
      <div className="workspace-detail-back"><Link href="/projects">← {t("backToProjects")}</Link></div>
      <header className="workspace-page-heading">
        <div>
          <span className="workspace-section-index">PROJECT / {project.id}</span>
          <h1>{project.name}</h1>
          <p>{t("projectOverviewBody")}</p>
        </div>
        <span className="workspace-status workspace-status-muted"><span className="workspace-status-dot" aria-hidden="true" />{t("runtimeUnavailable")}</span>
      </header>

      <section className="workspace-detail-grid" aria-label={t("projectOverview")}>
        <Card className="workspace-detail-overview">
          <span className="workspace-section-index">01 / OVERVIEW</span>
          <h2>{t("projectOverview")}</h2>
          <p>{t("projectOverviewBody")}</p>
          <dl className="workspace-detail-facts">
            <div><dt>{t("projectId")}</dt><dd>{project.id}</dd></div>
            <div><dt>{t("personalSpace")}</dt><dd>{project.spaceId || t("personalSpace")}</dd></div>
            <div><dt>{t("projectTeam")}</dt><dd>{project.teamName || t("personalTeam")}</dd></div>
          </dl>
        </Card>
        <div className="flex flex-col gap-4">
          <Card className="workspace-detail-section">
            <span className="workspace-section-index">02 / RUNTIME</span>
            <h2>{t("runtimeTitle")}</h2>
            <p>{t("runtimeBody")}</p>
            <p className="workspace-status workspace-status-muted"><span className="workspace-status-dot" aria-hidden="true" />{t("runtimeUnavailable")}</p>
            <Link href="/sandboxes"><Button variant="primary" size="sm">{t("openRuntimes")}</Button></Link>
          </Card>
          <Card className="workspace-detail-section">
            <span className="workspace-section-index">03 / ARTIFACTS</span>
            <h2>{t("artifactsTitle")}</h2>
            <p>{t("artifactsBody")}</p>
            <span className="workspace-coming-soon">{t("artifactsComingSoon")}</span>
          </Card>
        </div>
      </section>
    </div>
  );
}

function DetailState({ title, body, action, href, onAction }: { title: string; body: string; action: string; href?: string; onAction?: () => void }) {
  return (
    <section className="workspace-state-panel" aria-live="polite">
      <span className="workspace-section-index">PROJECT / STATUS</span>
      <h1>{title}</h1>
      <p>{body}</p>
      {href ? <Link href={href}><Button variant="secondary">{action}</Button></Link> : <Button variant="secondary" onPress={onAction}>{action}</Button>}
    </section>
  );
}
