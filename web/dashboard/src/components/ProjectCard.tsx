import Link from "next/link";
import { useTranslations } from "next-intl";
import type { ProjectRecord } from "@/lib/projects";

// A Project tile: the whole card opens the Project. The sandbox state is shown on the Project page.
export default function ProjectCard({ project }: { project: ProjectRecord }) {
  const t = useTranslations("workspace");
  const teamLabel = project.teamName || t("personalTeam");
  const href = `/projects/${encodeURIComponent(project.id)}`;

  return (
    <Link href={href} className="project-card">
      <span className="project-card-team">{teamLabel}</span>
      <h2 className="project-card-name">{project.name}</h2>
      <span className="project-card-footer">
        <span className="project-card-id">{project.id.slice(0, 8)}</span>
        <span className="text-link">{t("openProject")} →</span>
      </span>
    </Link>
  );
}
