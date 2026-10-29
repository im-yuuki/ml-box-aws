import Link from "next/link";
import { Button, Card } from "@heroui/react";
import { useTranslations } from "next-intl";
import type { ProjectRecord } from "@/lib/projects";

export default function ProjectCard({ project }: { project: ProjectRecord }) {
  const t = useTranslations("workspace");
  const teamLabel = project.teamName || t("personalTeam");

  return (
    <Card className="workspace-project-card">
      <div className="workspace-project-card-topline">
        <span className="workspace-card-kicker">{teamLabel}</span>
        <span className="workspace-status workspace-status-muted">
          <span className="workspace-status-dot" aria-hidden="true" />
          {t("runtimeUnavailable")}
        </span>
      </div>
      <div className="flex flex-col gap-2">
        <h2 className="text-xl font-semibold tracking-tight">{project.name}</h2>
        <p className="workspace-mono-label">{t("projectId")} · {project.id}</p>
      </div>
      <div className="workspace-project-card-actions">
        <Link href={`/projects/${encodeURIComponent(project.id)}`}>
          <Button variant="primary" size="sm">{t("openProject")}</Button>
        </Link>
        {project.sandboxName ? (
          <Link href="/sandboxes">
            <Button variant="secondary" size="sm">{t("openSandbox")}</Button>
          </Link>
        ) : null}
      </div>
    </Card>
  );
}
