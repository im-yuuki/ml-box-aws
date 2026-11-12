export type ProjectRecord = {
  id: string;
  name: string;
  teamName?: string;
  spaceId?: string;
  teamId?: string;
  runtimeStatus?: string;
  sandboxName?: string;
  // Whether the viewer may manage the Project (delete it).
  canManage?: boolean;
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

// The BFF bounds the name of a Project as well; the same limit is used here so the user is told
// before the request is sent.
export const PROJECT_NAME_MAX_LENGTH = 80;

export function validateProjectName(name: string): { ok: true; value: string } | { ok: false; reason: "empty" | "tooLong" } {
  const value = name.trim();
  if (!value) return { ok: false, reason: "empty" };
  if (value.length > PROJECT_NAME_MAX_LENGTH) return { ok: false, reason: "tooLong" };
  return { ok: true, value };
}

export function getCreateProjectNavigation(body: { project?: { id?: string; name?: string } }): string | null {
  const id = body.project?.id;
  return id ? `/projects/${encodeURIComponent(id)}` : null;
}
