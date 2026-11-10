"use client";

import Link from "next/link";
import type { ProjectRecord } from "@/lib/projects";
import { useProjectSandbox } from "@/hooks/useProjectSandbox";
import ProjectRuntimeControl from "@/components/ProjectRuntimeControl";
import InstanceType from "@/components/InstanceType";

/**
 * One Project in the list: its name, the instance it runs on (under the name while running), and the single
 * launch action. Everything else lives on the details page.
 */
export default function ProjectRow({ project }: { project: ProjectRecord }) {
  const href = `/projects/${encodeURIComponent(project.id)}`;
  const sandbox = useProjectSandbox(project.id);
  const running = sandbox.stateKey === "running";

  return (
    <li className="workspace-project-row">
      <div className="flex min-w-0 flex-col gap-1">
        <Link href={href} className="workspace-project-row-name">{project.name}</Link>
        {running && sandbox.runningProfile ? (
          <div className="text-xs" style={{ color: "var(--muted)" }}>
            <InstanceType slug={sandbox.runningProfile} profiles={sandbox.profiles} />
          </div>
        ) : null}
      </div>
      <ProjectRuntimeControl sandbox={sandbox} />
    </li>
  );
}
