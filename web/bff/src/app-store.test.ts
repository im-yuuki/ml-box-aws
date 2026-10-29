import assert from "node:assert/strict";
import test from "node:test";
import { AppStore } from "./app-store.js";

test("bootstrap creates stable personal space and default team for a Cognito subject", async () => {
  const queries: string[] = [];
  const client = {
    query: async (sql: string) => {
      queries.push(sql);
      return { rows: [] };
    },
    release: () => undefined,
  };
  const store = new AppStore({
    query: async (sql: string) => {
      queries.push(sql);
      return { rows: [] };
    },
    connect: async () => client,
    end: async () => undefined,
  });

  const context = await store.ensureUserBootstrap("cognito-sub", "person@example.com");

  assert.deepEqual(context, {
    userId: "cognito-sub",
    email: "person@example.com",
    personalSpaceId: "personal:cognito-sub",
    defaultTeamId: "personal-team:cognito-sub",
  });
  assert.ok(queries.some((query) => query.includes("mlbox_users")));
});

test("project permission is resolved from server-side membership rows", async () => {
  const store = new AppStore({
    query: async () => ({ rows: [{ space_role: "member", team_role: "lead", direct_role: "blocked" }] }),
    connect: async () => { throw new Error("connect is not expected for this test"); },
    end: async () => undefined,
  });

  const permission = await store.projectPermission("cognito-sub", "project-1");

  assert.equal(permission, null);
});

test("compatibility sandbox projects are owned by the authenticated subject", async () => {
  const queries: Array<{ sql: string; values?: unknown[] }> = [];
  const store = new AppStore({
    query: async (sql: string, values?: unknown[]) => {
      queries.push({ sql, values });
      if (sql.includes("FROM mlbox_sandboxes")) return { rows: [] };
      if (sql.includes("INSERT INTO mlbox_projects")) {
        return { rows: [{ id: "project-1", team_id: "personal-team:cognito-sub", name: "sandbox-a", created_by: "cognito-sub" }] };
      }
      return { rows: [] };
    },
    connect: async () => { throw new Error("connect is not expected for this test"); },
    end: async () => undefined,
  });

  const project = await store.ensureSandboxProject("cognito-sub", "user@example.com", "sandbox-a");

  assert.equal(project.id, "project-1");
  assert.equal(project.teamId, "personal-team:cognito-sub");
  assert.ok(queries.some(({ sql, values }) => sql.includes("mlbox_sandboxes") && values?.includes("user@example.com")));
});

test("sandbox project permission is resolved for the authenticated subject", async () => {
  let projectId = "";
  const store = new AppStore({
    query: async (sql: string) => {
      if (sql.includes("INSERT INTO mlbox_projects")) {
        projectId = "project-1";
        return { rows: [{ id: projectId, team_id: "personal-team:cognito-sub", name: "sandbox-a", created_by: "cognito-sub", space_id: "personal:cognito-sub" }] };
      }
      if (sql.includes("FROM mlbox_projects p")) {
        return { rows: [{ space_role: "owner", team_role: "lead", direct_role: "blocked" }] };
      }
      return { rows: [] };
    },
    connect: async () => { throw new Error("connect is not expected for this test"); },
    end: async () => undefined,
  });

  const project = await store.ensureSandboxProject("cognito-sub", "user@example.com", "sandbox-a");
  const permission = await store.projectPermission("cognito-sub", project.id);

  assert.equal(permission?.canOperate, true);
});

test("authorized sandbox names come from app-owned project mappings", async () => {
  const store = new AppStore({
    query: async () => ({ rows: [{ server_name: "sandbox-a" }] }),
    connect: async () => { throw new Error("connect is not expected for this test"); },
    end: async () => undefined,
  });

  assert.deepEqual(await store.listAuthorizedSandboxNames("cognito-sub", "read"), ["sandbox-a"]);
});

test("sandbox authorization denies a blocked project before Hub access", async () => {
  const store = new AppStore({
    query: async (sql: string) => {
      if (sql.includes("FROM mlbox_sandboxes sb")) {
        return { rows: [{ id: "project-1", team_id: "personal-team:cognito-sub", name: "sandbox-a", created_by: "cognito-sub", space_id: "personal:cognito-sub" }] };
      }
      if (sql.includes("FROM mlbox_projects p")) {
        return { rows: [{ space_role: "member", team_role: "member", direct_role: "blocked" }] };
      }
      return { rows: [] };
    },
    connect: async () => { throw new Error("connect is not expected for this test"); },
    end: async () => undefined,
  });

  const authorized = await store.authorizeSandbox("cognito-sub", "user@example.com", "sandbox-a", "operate");

  assert.equal(authorized, false);
});

test("sandbox authorization does not invent a mapping when no project exists", async () => {
  const queries: string[] = [];
  const store = new AppStore({
    query: async (sql: string) => {
      queries.push(sql);
      if (sql.includes("FROM mlbox_sandboxes sb")) return { rows: [] };
      throw new Error(`unexpected query: ${sql}`);
    },
    connect: async () => { throw new Error("connect is not expected for this test"); },
    end: async () => undefined,
  });

  const authorized = await store.authorizeSandbox("cognito-sub", "user@example.com", "sandbox-a", "operate");

  assert.equal(authorized, false);
  assert.equal(queries.some((sql) => sql.includes("INSERT INTO mlbox_projects")), false);
});

test("activating a mock subscription uses the authenticated personal Space", async () => {
  const queries: Array<{ sql: string; values?: unknown[] }> = [];
  const store = new AppStore({
    query: async (sql: string, values?: unknown[]) => {
      queries.push({ sql, values });
      if (sql.includes("INSERT INTO mlbox_space_subscriptions")) {
        return { rows: [{ space_id: "personal:cognito-sub", plan: "pro", status: "active", provider: "mock" }] };
      }
      return { rows: [] };
    },
    connect: async () => { throw new Error("connect is not expected for this test"); },
    end: async () => undefined,
  });

  const subscription = await store.activateMockSubscription("cognito-sub", "personal:cognito-sub", "pro");

  assert.deepEqual(subscription, { spaceId: "personal:cognito-sub", plan: "pro", status: "active", provider: "mock" });
  assert.deepEqual(queries[0]?.values, ["cognito-sub", "personal:cognito-sub", "pro"]);
  assert.equal(queries.some(({ sql }) => sql.includes("mlbox_audit_events")), true);
});

test("creating a project uses the authenticated user and selected team scope", async () => {
  const queries: Array<{ sql: string; values?: unknown[] }> = [];
  const store = new AppStore({
    query: async (sql: string, values?: unknown[]) => {
      queries.push({ sql, values });
      return { rows: [{ id: "project-1", team_id: "team-1", name: "Project One", created_by: "cognito-sub" }] };
    },
    connect: async () => { throw new Error("connect is not expected for this test"); },
    end: async () => undefined,
  });

  const project = await store.createProject("cognito-sub", "space-1", "team-1", "Project One");

  assert.deepEqual(project, {
    id: "project-1",
    spaceId: "space-1",
    teamId: "team-1",
    name: "Project One",
    createdBy: "cognito-sub",
  });
  assert.deepEqual(queries.at(-1)?.values?.slice(0, 4), ["cognito-sub", "space-1", "team-1", "Project One"]);
  assert.match(String(queries.at(-1)?.values?.[4]), /^[0-9a-f-]{36}$/);
});
