"use client";

import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import Link from "next/link";
import { Button } from "@heroui/react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { bffFetch } from "@/lib/bffFetch";
import {
  classifyProjectResponse,
  filterProjects,
  getCreateProjectNavigation,
  validateProjectName,
  type ProjectListResponse,
  type ProjectLoadState,
  type ProjectRecord,
} from "@/lib/projects";
import ProjectCard from "@/components/ProjectCard";

type CreateProjectResponse = { project?: ProjectRecord };

export default function ProjectBoard() {
  const t = useTranslations("workspace");
  const router = useRouter();
  const [projects, setProjects] = useState<ProjectRecord[]>([]);
  const [spaceId, setSpaceId] = useState<string | undefined>();
  const [query, setQuery] = useState("");
  const [loadState, setLoadState] = useState<ProjectLoadState | "loading">("loading");
  const [projectName, setProjectName] = useState("");
  const [createError, setCreateError] = useState(false);
  const [creating, setCreating] = useState(false);

  const loadProjects = useCallback(async () => {
    setLoadState("loading");
    try {
      const response = await bffFetch("/api/bff/projects", { cache: "no-store" });
      setLoadState(classifyProjectResponse(response.status));
      if (!response.ok) return;
      const body = await response.json() as ProjectListResponse;
      setProjects(Array.isArray(body.projects) ? body.projects : []);
      setSpaceId(body.spaceId);
    } catch {
      setLoadState("unavailable");
    }
  }, []);

  useEffect(() => {
    const task = window.setTimeout(() => void loadProjects(), 0);
    return () => window.clearTimeout(task);
  }, [loadProjects]);

  const visibleProjects = useMemo(() => filterProjects(projects, query), [projects, query]);

  const createProject = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setCreateError(false);
    const validated = validateProjectName(projectName);
    if (!validated.ok) {
      setCreateError(true);
      return;
    }
    setCreating(true);
    try {
      const response = await bffFetch("/api/bff/projects", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: validated.value, spaceId }),
      });
      if (!response.ok) {
        setCreateError(true);
        return;
      }
      const body = await response.json() as CreateProjectResponse;
      const destination = getCreateProjectNavigation(body);
      if (!destination) {
        setCreateError(true);
        return;
      }
      router.push(destination);
    } catch {
      setCreateError(true);
    } finally {
      setCreating(false);
    }
  };

  if (loadState === "loading") {
    return <p className="workspace-muted-copy" role="status">{t("loadingProjects")}</p>;
  }

  if (loadState === "unauthenticated") {
    return (
      <section className="workspace-state-panel" aria-labelledby="projects-auth-title">
        <span className="workspace-section-index">{t("authSection")}</span>
        <h2 id="projects-auth-title">{t("unauthenticatedTitle")}</h2>
        <p>{t("unauthenticatedBody")}</p>
        <Link href="/login"><Button variant="primary">{t("signIn")}</Button></Link>
      </section>
    );
  }

  if (loadState === "unauthorized") {
    return <StatePanel title={t("unauthorizedTitle")} body={t("unauthorizedBody")} action={t("retry")} onAction={() => void loadProjects()} />;
  }

  if (loadState === "unavailable") {
    return <StatePanel title={t("unavailableTitle")} body={t("unavailableBody")} action={t("retry")} onAction={() => void loadProjects()} />;
  }

  return (
    <div className="flex flex-col gap-8">
      <header className="workspace-page-heading">
        <div>
          <span className="workspace-section-index">{t("projectsSection")}</span>
          <h1>{t("projectsTitle")}</h1>
          <p>{t("projectsSubtitle")}</p>
        </div>
        <span className="workspace-count-label">{t("projectCount", { count: projects.length })}</span>
      </header>

      <section className="workspace-project-toolbar" aria-label={t("searchProjects")}>
        <label className="workspace-search-field">
          <span className="sr-only">{t("searchProjects")}</span>
          <span aria-hidden="true">⌕</span>
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t("searchProjectsHint")} />
        </label>
        <form className="workspace-create-form" onSubmit={createProject}>
          <label className="sr-only" htmlFor="new-project-name">{t("projectName")}</label>
          <input id="new-project-name" value={projectName} onChange={(event) => setProjectName(event.target.value)} placeholder={t("projectNamePlaceholder")} />
          <Button type="submit" variant="primary" isPending={creating} isDisabled={creating}>{t("newProject")}</Button>
        </form>
      </section>
      {createError ? <p className="workspace-form-error" role="alert">{projectName.trim() ? t("projectCreateFailed") : t("projectNameRequired")}</p> : null}

      {projects.length === 0 ? (
        <section className="workspace-state-panel" aria-labelledby="projects-empty-title">
          <span className="workspace-section-index">{t("workspaceSection")}</span>
          <h2 id="projects-empty-title">{t("projectsEmptyTitle")}</h2>
          <p>{t("projectsEmptyBody")}</p>
        </section>
      ) : visibleProjects.length === 0 ? (
        <section className="workspace-state-panel" aria-labelledby="projects-results-title">
          <h2 id="projects-results-title">{t("noResultsTitle")}</h2>
          <p>{t("noResultsBody")}</p>
        </section>
      ) : (
        <section className="workspace-project-grid" aria-label={t("projectsTitle")}>
          {visibleProjects.map((project) => <ProjectCard key={project.id} project={project} />)}
        </section>
      )}
    </div>
  );
}

function StatePanel({ title, body, action, onAction }: { title: string; body: string; action: string; onAction: () => void }) {
  const t = useTranslations("workspace");

  return (
    <section className="workspace-state-panel" aria-live="polite">
      <span className="workspace-section-index">{t("statusSection")}</span>
      <h2>{title}</h2>
      <p>{body}</p>
      <Button variant="secondary" onPress={onAction}>{action}</Button>
    </section>
  );
}
