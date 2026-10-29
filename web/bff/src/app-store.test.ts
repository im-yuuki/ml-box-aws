import assert from "node:assert/strict";
import test from "node:test";
import { AppStore } from "./app-store.js";
import type { HubIdentity } from "./hub-identity.js";

test("identity schema is additive and preserves sandbox ownership", async () => {
  const queries: string[] = [];
  const store = new AppStore({
    query: async (sql: string) => {
      queries.push(sql);
      return { rows: [] };
    },
    connect: async () => { throw new Error("connect is not expected for this test"); },
    end: async () => undefined,
  });

  await store.ensureSchema();

  const schema = queries.join("\\n");
  assert.match(schema, /CREATE TABLE IF NOT EXISTS mlbox_hub_identities/);
  assert.match(schema, /UNIQUE \(hub_username\)/);
  assert.match(schema, /previous_hub_username/);
  assert.match(schema, /CREATE UNIQUE INDEX IF NOT EXISTS mlbox_hub_identities_hub_username_idx/);
  assert.equal(schema.includes("UPDATE mlbox_sandboxes"), false);
});

test("legacy Hub identity mapping is stored and read without changing username on email update", async () => {
  const queries: Array<{ sql: string; values?: unknown[] }> = [];
  const mapping: HubIdentity = {
    userId: "cognito-sub",
    hubUsername: "old@example.com",
    legacyEmail: "old@example.com",
    previousHubUsername: null,
    status: "legacy",
  };
  const store = new AppStore({
    query: async (sql: string, values?: unknown[]) => {
      queries.push({ sql, values });
      if (sql.includes("FROM mlbox_hub_identities")) {
        return { rows: [{ ...mapping }] };
      }
      return { rows: [] };
    },
    connect: async () => { throw new Error("connect is not expected for this test"); },
    end: async () => undefined,
  });

  await store.upsertHubIdentity(mapping);
  const loaded = await store.getHubIdentity("cognito-sub");
  await store.upsertHubIdentity({ ...mapping, legacyEmail: "new@example.com" });

  assert.deepEqual(loaded, mapping);
  assert.equal(queries.some(({ sql, values }) => sql.includes("mlbox_hub_identities") && values?.includes("old@example.com")), true);
  assert.equal(queries.some(({ sql, values }) => sql.includes("mlbox_hub_identities") && values?.includes("new@example.com")), true);
  assert.equal(queries.some(({ sql }) => sql.includes("UPDATE mlbox_sandboxes")), false);
});

test("identity conflict is rejected before store writes", async () => {
  const store = new AppStore({
    query: async () => { throw new Error("identity write should not happen"); },
    connect: async () => { throw new Error("connect is not expected for this test"); },
    end: async () => undefined,
  });
  await assert.rejects(() => store.upsertHubIdentity({
    userId: "cognito-sub",
    hubUsername: "shared",
    legacyEmail: "user@example.com",
    previousHubUsername: null,
    status: "conflict",
  }), /conflict/i);
});

test("identity migration candidates are read without changing sandbox mappings", async () => {
  const queries: string[] = [];
  const store = new AppStore({
    query: async (sql: string) => {
      queries.push(sql);
      if (sql.includes("FROM mlbox_hub_identities")) {
        return { rows: [{ user_id: "cognito-sub", hub_username: "old@example.com", legacy_email: "old@example.com", previous_hub_username: null, status: "legacy" }] };
      }
      return { rows: [] };
    },
    connect: async () => { throw new Error("connect is not expected for this test"); },
    end: async () => undefined,
  });

  const candidates = await store.listHubIdentityMappings();
  assert.equal(candidates[0]?.hubUsername, "old@example.com");
  assert.equal(queries.some((sql) => sql.includes("mlbox_sandboxes")), false);
});

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

test("compatibility mock activation rejects plans outside the demo catalog", async () => {
  const store = new AppStore({
    query: async () => ({ rows: [] }),
    connect: async () => { throw new Error("connect is not expected for this test"); },
    end: async () => undefined,
  });

  await assert.rejects(
    store.activateMockSubscription("cognito-sub", "personal:cognito-sub", "pro"),
    /Invalid subscription plan/,
  );
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
