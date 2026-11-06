import Link from "next/link";
import { useTranslations } from "next-intl";
import { ChevronRight } from "lucide-react";
import type { ProjectRecord } from "@/lib/projects";
import ProjectRuntimeControl from "@/components/ProjectRuntimeControl";

/** One Project in the list: name and team, runtime state with controls, and a link to its page. */
export default function ProjectRow({ project }: { project: ProjectRecord }) {
  const t = useTranslations("workspace");
  const teamLabel = project.teamName || t("personalTeam");
  const href = `/projects/${encodeURIComponent(project.id)}`;

  return (
    <li className="workspace-project-row">
      <div className="min-w-0">
        <Link href={href} className="workspace-project-row-name">{project.name}</Link>
        <div className="workspace-project-row-meta">
          {teamLabel} · <code>{project.id}</code>
        </div>
      </div>
      <ProjectRuntimeControl projectId={project.id} />
      <Link href={href} className="workspace-project-row-open" aria-label={t("openProject")}>
        <ChevronRight aria-hidden="true" size={18} />
      </Link>
    </li>
  );
}
