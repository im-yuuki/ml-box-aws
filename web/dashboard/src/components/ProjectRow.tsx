import Link from "next/link";
import type { ProjectRecord } from "@/lib/projects";
import ProjectRuntimeControl from "@/components/ProjectRuntimeControl";

/** One Project in the list: its name, the instance type, and the single launch action. Everything else lives on the details page. */
export default function ProjectRow({ project }: { project: ProjectRecord }) {
  const href = `/projects/${encodeURIComponent(project.id)}`;

  return (
    <li className="workspace-project-row">
      <Link href={href} className="workspace-project-row-name">{project.name}</Link>
      <ProjectRuntimeControl projectId={project.id} />
    </li>
  );
}
