"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type FormEvent,
} from "react";
import Link from "next/link";
import {
  Button,
  Card,
  FieldError,
  Input,
  Label,
  Modal,
  Spinner,
  TextField,
} from "@heroui/react";
import { LogIn, Plus, RotateCcw } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
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
import ProjectRow from "@/components/ProjectRow";
import { useActiveSpace } from "@/hooks/useActiveSpace";

type CreateProjectResponse = { project?: ProjectRecord };
type TeamOption = { id: string; name: string };

/**
 * The single workspace page: Projects with their notebook runtimes. The navbar
 * search filters the list through ?q=; new projects are created from a dialog.
 */
export default function ProjectBoard() {
  const t = useTranslations("workspace");
  const router = useRouter();
  const searchParams = useSearchParams();
  const urlQuery = searchParams.get("q") ?? "";
  const [projects, setProjects] = useState<ProjectRecord[]>([]);
  const {
    activeSpace,
    loading: spacesLoading,
    failed: spacesFailed,
    reload: reloadSpaces,
  } = useActiveSpace();
  const [teams, setTeams] = useState<TeamOption[]>([]);
  const [loadState, setLoadState] = useState<ProjectLoadState | "loading">(
    "loading",
  );
  const [projectName, setProjectName] = useState("");
  const [createError, setCreateError] = useState(false);
  const [creating, setCreating] = useState(false);

  const activeSpaceId = activeSpace?.id ?? null;
  const isOrganization = activeSpace?.type === "organization";

  const loadProjects = useCallback(async () => {
    setLoadState("loading");
    try {
      const search = activeSpaceId
        ? `?spaceId=${encodeURIComponent(activeSpaceId)}`
        : "";
      const response = await bffFetch(`/api/bff/projects${search}`, {
        cache: "no-store",
      });
      setLoadState(classifyProjectResponse(response.status));
      if (!response.ok) return;
      const body = (await response.json()) as ProjectListResponse;
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

  // Teams only exist inside organizations; a new project in one needs a team.
  useEffect(() => {
    if (!activeSpaceId || !isOrganization) {
      const task = window.setTimeout(() => setTeams([]), 0);
      return () => window.clearTimeout(task);
    }
    let cancelled = false;
    const task = window.setTimeout(() => {
      bffFetch(`/api/bff/spaces/${encodeURIComponent(activeSpaceId)}/teams`, {
        cache: "no-store",
      })
        .then((response) =>
          response.ok
            ? (response.json() as Promise<{ teams?: TeamOption[] }>)
            : { teams: [] },
        )
        .then((body) => {
          if (!cancelled) setTeams(Array.isArray(body.teams) ? body.teams : []);
        })
        .catch(() => {
          if (!cancelled) setTeams([]);
        });
    }, 0);
    return () => {
      cancelled = true;
      window.clearTimeout(task);
    };
  }, [activeSpaceId, isOrganization]);

  const visibleProjects = useMemo(
    () => filterProjects(projects, urlQuery),
    [projects, urlQuery],
  );

  const createProject = async (
    event: FormEvent<HTMLFormElement>,
    close: () => void,
  ) => {
    event.preventDefault();
    setCreateError(false);
    const validated = validateProjectName(projectName);
    if (!validated.ok || !activeSpaceId) {
      setCreateError(true);
      return;
    }
    setCreating(true);
    try {
      // Organization Spaces need an explicit team; personal Spaces use their default team.
      let teamId: string | undefined;
      if (isOrganization) {
        teamId = teams[0]?.id;
        if (!teamId) {
          setCreateError(true);
          return;
        }
      }
      const response = await bffFetch("/api/bff/projects", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: validated.value,
          spaceId: activeSpaceId,
          ...(teamId ? { teamId } : {}),
        }),
      });
      if (!response.ok) {
        setCreateError(true);
        return;
      }
      const body = (await response.json()) as CreateProjectResponse;
      const destination = getCreateProjectNavigation(body);
      if (!destination) {
        setCreateError(true);
        return;
      }
      close();
      router.push(destination);
    } catch {
      setCreateError(true);
    } finally {
      setCreating(false);
    }
  };

  // Projects load only once a Space is known. If the Spaces request failed (or returned none), the
  // Projects request never starts, so this must be an error state, not an endless spinner.
  const spacesUnavailable = !spacesLoading && (spacesFailed || !activeSpace);
  if (spacesUnavailable) {
    return (
      <StatePanel
        title={t("unavailableTitle")}
        body={t("unavailableBody")}
        action={t("retry")}
        onAction={reloadSpaces}
      />
    );
  }

  if (loadState === "loading") {
    return (
      <div className="flex items-center gap-2 text-sm" role="status">
        <Spinner size="sm" />
        <span>{t("loadingProjects")}</span>
      </div>
    );
  }

  if (loadState === "unauthenticated") {
    return (
      <Card className="p-6" aria-labelledby="projects-auth-title">
        <h2 id="projects-auth-title">{t("unauthenticatedTitle")}</h2>
        <Link href="/login">
          <Button variant="primary">
            <LogIn aria-hidden="true" size={16} />
            {t("signIn")}
          </Button>
        </Link>
      </Card>
    );
  }

  if (loadState === "unauthorized") {
    return (
      <StatePanel
        title={t("unauthorizedTitle")}
        body={t("unauthorizedBody")}
        action={t("retry")}
        onAction={() => void loadProjects()}
      />
    );
  }

  if (loadState === "unavailable") {
    return (
      <StatePanel
        title={t("unavailableTitle")}
        body={t("unavailableBody")}
        action={t("retry")}
        onAction={() => void loadProjects()}
      />
    );
  }

  return (
    <div className="flex flex-col gap-8">
      <header className="workspace-page-heading">
        <div>
          <h1>{t("projectsTitle")}</h1>
        </div>
        <div className="flex flex-col items-end gap-3">
          <Modal
            onOpenChange={(open) => {
              if (!open) setCreateError(false);
            }}>
            <Modal.Trigger>
              <Button variant="primary">
                <Plus aria-hidden="true" size={16} />
                {t("newProject")}
              </Button>
            </Modal.Trigger>
            <Modal.Backdrop>
              <Modal.Container>
                <Modal.Dialog>
                  {({ close }) => (
                    <form
                      onSubmit={(event) => void createProject(event, close)}
                      className="flex flex-col gap-4">
                      <Modal.Header>
                        <Modal.Heading>{t("newProject")}</Modal.Heading>
                      </Modal.Header>
                      <Modal.Body className="flex flex-col gap-3">
                        <TextField
                          value={projectName}
                          onChange={setProjectName}
                          autoFocus
                          isInvalid={createError}>
                          <Label>{t("projectName")}</Label>
                          <Input
                            placeholder={t("projectNamePlaceholder")}
                            variant="secondary"
                            fullWidth
                          />
                          {createError ? (
                            <FieldError>
                              {projectName.trim()
                                ? t("projectCreateFailed")
                                : t("projectNameRequired")}
                            </FieldError>
                          ) : null}
                        </TextField>
                      </Modal.Body>
                      <Modal.Footer className="flex justify-end gap-2">
                        <Button variant="tertiary" onPress={close}>
                          {t("cancel")}
                        </Button>
                        <Button
                          type="submit"
                          variant="primary"
                          isPending={creating}
                          isDisabled={creating}>
                          {t("createProject")}
                        </Button>
                      </Modal.Footer>
                    </form>
                  )}
                </Modal.Dialog>
              </Modal.Container>
            </Modal.Backdrop>
          </Modal>
        </div>
      </header>

      {urlQuery ? (
        <p className="text-sm" style={{ color: "var(--muted)" }} role="status">
          {t("filteredBy", { query: urlQuery })} ·{" "}
          <Link href="/projects">{t("clearFilter")}</Link>
        </p>
      ) : null}

      {projects.length === 0 ? (
        <Card className="p-6" aria-labelledby="projects-empty-title">
          <h2 id="projects-empty-title">{t("projectsEmptyTitle")}</h2>
        </Card>
      ) : visibleProjects.length === 0 ? (
        <Card className="p-6" aria-labelledby="projects-results-title">
          <h2 id="projects-results-title">{t("noResultsTitle")}</h2>
        </Card>
      ) : (
        <section
          aria-label={t("projectsTitle")}
          className="flex flex-col gap-2">
          <ul className="workspace-project-list">
            {visibleProjects.map((project) => (
              <ProjectRow key={project.id} project={project} />
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

function StatePanel({
  title,
  body,
  action,
  onAction,
}: {
  title: string;
  body: string;
  action: string;
  onAction: () => void;
}) {
  return (
    <Card className="p-6" aria-live="polite">
      <h2>{title}</h2>
      <p>{body}</p>
      <Button variant="secondary" onPress={onAction}>
        <RotateCcw aria-hidden="true" size={16} />
        {action}
      </Button>
    </Card>
  );
}
