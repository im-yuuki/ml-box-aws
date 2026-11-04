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
import { useActiveSpace } from "@/hooks/useActiveSpace";

type CreateProjectResponse = { project?: ProjectRecord };

export default function ProjectBoard() {
  const t = useTranslations("workspace");
  const router = useRouter();
  const [projects, setProjects] = useState<ProjectRecord[]>([]);
  const { activeSpace } = useActiveSpace();
  const [query, setQuery] = useState("");
  const [loadState, setLoadState] = useState<ProjectLoadState | "loading">("loading");
  const [projectName, setProjectName] = useState("");
  const [createError, setCreateError] = useState(false);
  const [creating, setCreating] = useState(false);

  const activeSpaceId = activeSpace?.id ?? null;

  const loadProjects = useCallback(async () => {
    setLoadState("loading");
    try {
      const query = activeSpaceId ? `?spaceId=${encodeURIComponent(activeSpaceId)}` : "";
      const response = await bffFetch(`/api/bff/projects${query}`, { cache: "no-store" });
      setLoadState(classifyProjectResponse(response.status));
      if (!response.ok) return;
      const body = await response.json() as ProjectListResponse;
      setProjects(Array.isArray(body.projects) ? body.projects : []);
    } catch {
      setLoadState("unavailable");
    }
  }, [activeSpaceId]);

  useEffect(() => {
    if (!activeSpaceId) return;
    const task = window.setTimeout(() => void loadProjects(), 0);
    return () => window.clearTimeout(task);
  }, [activeSpaceId, loadProjects]);

  const visibleProjects = useMemo(() => filterProjects(projects, query), [projects, query]);

  const createProject = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setCreateError(false);
    const validated = validateProjectName(projectName);
    if (!validated.ok) {
      setCreateError(true);
      return;
    }
    if (!activeSpaceId) {
      setCreateError(true);
      return;
    }
    setCreating(true);
    try {
      // Organization Spaces need an explicit team; personal Spaces use their default team.
      let teamId: string | undefined;
      if (activeSpace?.type === "organization") {
        const teamsResponse = await bffFetch(`/api/bff/spaces/${encodeURIComponent(activeSpaceId)}/teams`, { cache: "no-store" });
        const teamsBody = teamsResponse.ok ? await teamsResponse.json() as { teams?: Array<{ id: string }> } : { teams: [] };
        teamId = teamsBody.teams?.[0]?.id;
        if (!teamId) {
          setCreateError(true);
          return;
        }
      }
      const response = await bffFetch("/api/bff/projects", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: validated.value, spaceId: activeSpaceId, ...(teamId ? { teamId } : {}) }),
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
    return <p className="muted" role="status">{t("loadingProjects")}</p>;
  }

  if (loadState === "unauthenticated") {
    return (
      <section className="empty" aria-labelledby="projects-auth-title">
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
    <div className="page">
      <header className="page-header">
        <div className="page-header-text">
          <p className="page-kicker">{t("projectsSection")}</p>
          <h1 className="page-title">{t("projectsTitle")}</h1>
          <p className="page-lede">{t("projectsSubtitle")}</p>
        </div>
        <div className="page-header-meta">
          <span className="pill">{t("projectCount", { count: projects.length })}</span>
          <Link href="/teams" className="text-link">{t("teamsLink")}</Link>
        </div>
      </header>

      <section className="toolbar" aria-label={t("searchProjects")}>
        <label className="search">
          <span className="sr-only">{t("searchProjects")}</span>
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t("searchProjectsHint")} />
        </label>
        <form className="create" onSubmit={createProject}>
          <label className="sr-only" htmlFor="new-project-name">{t("projectName")}</label>
          <input id="new-project-name" value={projectName} onChange={(event) => setProjectName(event.target.value)} placeholder={t("projectNamePlaceholder")} />
          <Button type="submit" variant="primary" isPending={creating} isDisabled={creating}>{t("newProject")}</Button>
        </form>
      </section>
      {createError ? <p className="form-error" role="alert">{projectName.trim() ? t("projectCreateFailed") : t("projectNameRequired")}</p> : null}

      {projects.length === 0 ? (
        <section className="empty" aria-labelledby="projects-empty-title">
          <h2 id="projects-empty-title">{t("projectsEmptyTitle")}</h2>
          <p>{t("projectsEmptyBody")}</p>
        </section>
      ) : visibleProjects.length === 0 ? (
        <section className="empty" aria-labelledby="projects-results-title">
          <h2 id="projects-results-title">{t("noResultsTitle")}</h2>
          <p>{t("noResultsBody")}</p>
        </section>
      ) : (
        <section className="grid-cards" aria-label={t("projectsTitle")}>
          {visibleProjects.map((project) => <ProjectCard key={project.id} project={project} />)}
        </section>
      )}
    </div>
  );
}

function StatePanel({ title, body, action, onAction }: { title: string; body: string; action: string; onAction: () => void }) {
  const t = useTranslations("workspace");

  return (
    <section className="empty" aria-live="polite">
      <h2>{title}</h2>
      <p>{body}</p>
      <Button variant="secondary" onPress={onAction}>{action}</Button>
    </section>
  );
}
