export type ProjectRecord = {
  id: string;
  name: string;
  teamName?: string;
  spaceId?: string;
  teamId?: string;
  runtimeStatus?: string;
  sandboxName?: string;
};

export type ProjectListResponse = {
  spaceId?: string;
  projects: ProjectRecord[];
};

export type ProjectLoadState = "ready" | "unauthenticated" | "unauthorized" | "unavailable";

export function classifyProjectResponse(status: number): ProjectLoadState {
  if (status === 401) return "unauthenticated";
  if (status === 403) return "unauthorized";
  if (status >= 500) return "unavailable";
  return "ready";
}

export function filterProjects(projects: ProjectRecord[], query: string): ProjectRecord[] {
  const normalizedQuery = query.trim().toLocaleLowerCase();
  if (!normalizedQuery) return [...projects];

  return projects.filter((project) =>
    [project.name, project.teamName].some((value) => value?.toLocaleLowerCase().includes(normalizedQuery)),
  );
}

export function resolveProject(projects: ProjectRecord[], projectId: string | undefined): ProjectRecord | null {
  if (!projectId) return null;
  return projects.find((project) => project.id === projectId) ?? null;
}

export function validateProjectName(name: string): { ok: true; value: string } | { ok: false } {
  const value = name.trim();
  return value ? { ok: true, value } : { ok: false };
}

export function getCreateProjectNavigation(body: { project?: { id?: string; name?: string } }): string | null {
  const id = body.project?.id;
  return id ? `/projects/${encodeURIComponent(id)}` : null;
}
