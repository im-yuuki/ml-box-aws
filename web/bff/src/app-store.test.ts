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

test("legacy Hub identity can be looked up by owner without reading unrelated sandboxes", async () => {
  const queries: string[] = [];
  const store = new AppStore({
    query: async (sql: string) => {
      queries.push(sql);
      if (sql.includes("mlbox_sandboxes")) {
        return { rows: [{ user_id: "cognito-sub", hub_username: "old@example.com", legacy_email: "old@example.com", status: "legacy" }] };
      }
      return { rows: [] };
    },
    connect: async () => { throw new Error("connect is not expected for this test"); },
    end: async () => undefined,
  });

  const identity = await store.findLegacyHubIdentityByUser("cognito-sub", "new@example.com");

  assert.equal(identity?.hubUsername, "old@example.com");
  assert.ok(queries[0]?.includes("FROM mlbox_sandboxes"));
});

test("legacy Hub identities can be looked up by email without reading sandboxes", async () => {
  const queries: string[] = [];
  const store = new AppStore({
    query: async (sql: string) => {
      queries.push(sql);
      if (sql.includes("legacy_email")) {
        return { rows: [{ user_id: "cognito-sub", hub_username: "old@example.com", legacy_email: "old@example.com", previous_hub_username: null, status: "legacy" }] };
      }
      return { rows: [] };
    },
    connect: async () => { throw new Error("connect is not expected for this test"); },
    end: async () => undefined,
  });

  const identity = await store.findHubIdentityByLegacyEmail("old@example.com");

  assert.equal(identity?.hubUsername, "old@example.com");
  assert.ok(queries[0]?.includes("WHERE legacy_email = $1"));
  assert.equal(queries.some((sql) => sql.includes("mlbox_sandboxes")), false);
});

test("resolved Hub username is stored without changing existing sandbox ownership", async () => {
  const queries: Array<{ sql: string; values?: unknown[] }> = [];
  const store = new AppStore({
    query: async (sql: string, values?: unknown[]) => {
      queries.push({ sql, values });
      if (sql.includes("INSERT INTO mlbox_projects")) {
        return { rows: [{ id: "project-1", team_id: "personal-team:cognito-sub", name: "sandbox-a", created_by: "cognito-sub" }] };
      }
      return { rows: [] };
    },
    connect: async () => { throw new Error("connect is not expected for this test"); },
    end: async () => undefined,
  });

  await store.ensureSandboxProject("cognito-sub", "new@example.com", "sandbox-a", "cognito-sub");

  assert.ok(queries.some(({ sql, values }) => sql.includes("mlbox_sandboxes") && values?.includes("cognito-sub")));
  assert.equal(queries.some(({ sql }) => sql.includes("UPDATE mlbox_sandboxes")), false);
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

test("identity migration dry-run reads mappings and performs no writes", async () => {
  const queries: string[] = [];
  const store = new AppStore({
    query: async (sql: string) => {
      queries.push(sql);
      if (sql.includes("FROM mlbox_hub_identities")) {
        return { rows: [
          { user_id: "sub-a", hub_username: "alice@example.com", legacy_email: "alice@example.com", previous_hub_username: null, status: "legacy" },
          { user_id: "sub-b", hub_username: "cognito-sub-b", legacy_email: "bob@example.com", previous_hub_username: null, status: "mapped" },
        ] };
      }
      return { rows: [] };
    },
    connect: async () => { throw new Error("connect is not expected for this test"); },
    end: async () => undefined,
  });

  const report = await store.planHubIdentityMigration();

  assert.equal(report.summary.total, 2);
  assert.equal(report.summary.ready, 1);
  assert.equal(report.summary.unchanged, 1);
  assert.equal(report.canApply, true);
  assert.equal(queries.every((sql) => !/^\\s*(INSERT|UPDATE|DELETE)/i.test(sql)), true);
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

function fakeStore(handler: (sql: string, values?: unknown[]) => { rows: Array<Record<string, unknown>> }) {
  const queries: Array<{ sql: string; values?: unknown[] }> = [];
  const runQuery = async (sql: string, values?: unknown[]) => {
    queries.push({ sql, values });
    return handler(sql, values);
  };
  const store = new AppStore({
    query: runQuery,
    connect: async () => ({ query: runQuery, release: () => undefined }),
    end: async () => undefined,
  });
  return { store, queries };
}

test("project listing hides blocked projects and non-members unless space owner, admin or viewer", async () => {
  const { store, queries } = fakeStore(() => ({ rows: [{ id: "p1", space_id: "s1", team_id: "t1", name: "P", created_by: "u1" }] }));
  const projects = await store.listProjects("u1", "s1");
  assert.equal(projects.length, 1);
  const sql = queries.at(-1)?.sql ?? "";
  assert.match(sql, /sm\.role IN \('owner', 'admin', 'viewer'\)/);
  assert.match(sql, /COALESCE\(pa\.role, ''\) <> 'blocked'/);
  assert.match(sql, /tm\.user_id IS NOT NULL OR pa\.role IS NOT NULL/);
});

test("project creation requires owner, admin or a team member of the target team", async () => {
  const { store, queries } = fakeStore(() => ({ rows: [] }));
  await assert.rejects(() => store.createProject("u1", "s1", "t1", "P"), /Project team access denied/);
  const sql = queries.at(-1)?.sql ?? "";
  assert.match(sql, /sm\.role IN \('owner', 'admin'\)/);
  assert.match(sql, /sm\.role = 'member' AND EXISTS/);
});

test("team creation is denied unless the actor is an active owner or admin", async () => {
  const { store, queries } = fakeStore(() => ({ rows: [] }));
  await assert.rejects(() => store.createTeam("u-member", "s1", "Team A"), new RegExp("Team management denied"));
  assert.match(queries.at(-1)?.sql ?? "", /sm\.role IN \('owner', 'admin'\)/);
});

test("team member add passes actor, space, team and target scope in order", async () => {
  const { store, queries } = fakeStore(() => ({ rows: [{ id: "t1" }] }));
  await store.addTeamMember("actor", "s1", "t1", "target", "lead");
  assert.deepEqual(queries.at(-1)?.values, ["actor", "s1", "t1", "target", "lead"]);
  assert.match(queries.at(-1)?.sql ?? "", /target\.user_id = \$4/);
});

test("team member removal is denied when the actor is not owner or admin", async () => {
  const { store } = fakeStore(() => ({ rows: [] }));
  await assert.rejects(() => store.removeTeamMember("actor", "s1", "t1", "target"), /Team management denied/);
});

test("team member listing requires an active Space membership and returns only the team scope", async () => {
  const { store, queries } = fakeStore(() => ({ rows: [{ user_id: "u2", role: "member", email: "b@example.com" }] }));
  const members = await store.listTeamMembers("actor", "s1", "t1");
  assert.deepEqual(members, [{ userId: "u2", role: "member", email: "b@example.com" }]);
  const last = queries.at(-1);
  assert.deepEqual(last?.values, ["actor", "s1", "t1"]);
  assert.match(last?.sql ?? "", /sm\.status = 'active'/);
});

test("project runtime is created under the project owner's Hub identity", async () => {
  const { store, queries } = fakeStore((sql) => {
    if (sql.includes("INSERT INTO mlbox_sandboxes")) return { rows: [] };
    return { rows: [{ project_id: "p1", owner_user_id: "owner", hub_username: "cognito-owner", server_name: "p1", state: "unknown" }] };
  });
  const runtime = await store.ensureProjectSandboxRuntime("p1");
  assert.deepEqual(runtime, { projectId: "p1", ownerUserId: "owner", hubUsername: "cognito-owner", serverName: "p1", state: "unknown", profile: null });
  const insert = queries.find((query) => query.sql.includes("INSERT INTO mlbox_sandboxes"));
  assert.match(insert?.sql ?? "", /JOIN mlbox_hub_identities hi ON hi\.user_id = p\.created_by/);
  assert.match(insert?.sql ?? "", /ON CONFLICT \(project_id\) DO NOTHING/);
});

test("project runtime creation fails closed when the owner has no Hub identity", async () => {
  const { store } = fakeStore((sql) => (sql.includes("FROM mlbox_sandboxes") ? { rows: [] } : { rows: [] }));
  await assert.rejects(() => store.ensureProjectSandboxRuntime("p1"), /Project runtime owner is not provisioned/);
});

test("removing the only team lead is rejected with a specific error", async () => {
  const { store } = fakeStore((sql) => {
    if (sql.includes("DELETE FROM mlbox_team_members")) return { rows: [] };
    return { rows: [{ target_is_lead: true, lead_count: "1" }] };
  });
  await assert.rejects(() => store.removeTeamMember("owner", "s1", "t1", "lead-1"), /at least one lead/);
});

test("demoting the only team lead is rejected with a specific error", async () => {
  const { store } = fakeStore((sql) => {
    if (sql.includes("INSERT INTO mlbox_team_members")) return { rows: [] };
    return { rows: [{ target_is_lead: true, lead_count: "1" }] };
  });
  await assert.rejects(() => store.addTeamMember("owner", "s1", "t1", "lead-1", "member"), /at least one lead/);
});

test("removing a non-lead member is still allowed by the guarded delete", async () => {
  const { store, queries } = fakeStore((sql) => (sql.includes("DELETE FROM mlbox_team_members") ? { rows: [{ team_id: "t1" }] } : { rows: [] }));
  await store.removeTeamMember("owner", "s1", "t1", "member-1");
  assert.match(queries.find((q) => q.sql.includes("DELETE FROM"))?.sql ?? "", /tm\.role <> 'lead' OR EXISTS/);
});

test("space listing returns only active memberships with the caller role", async () => {
  const { store, queries } = fakeStore(() => ({ rows: [{ id: "personal:u1", type: "personal", name: "u1's Space", role: "owner" }] }));
  const spaces = await store.listSpaces("u1");
  assert.deepEqual(spaces, [{ id: "personal:u1", type: "personal", name: "u1's Space", role: "owner" }]);
  assert.match(queries.at(-1)?.sql ?? "", /sm\.status = 'active'/);
  assert.deepEqual(queries.at(-1)?.values, ["u1"]);
});

test("usage sessions open only once per project and close on stop", async () => {
  const { store, queries } = fakeStore(() => ({ rows: [] }));
  await store.openUsageSession("p1", "u1", 10);
  await store.closeUsageSessions("p1");
  const open = queries.find((q) => q.sql.includes("INSERT INTO mlbox_usage_sessions"));
  assert.match(open?.sql ?? "", /AND NOT EXISTS \(SELECT 1 FROM mlbox_usage_sessions u WHERE u\.project_id = \$2 AND u\.ended_at IS NULL\)/);
  assert.match(queries.find((q) => q.sql.includes("UPDATE mlbox_usage_sessions"))?.sql ?? "", /ended_at IS NULL/);
});

test("project usage summary converts seconds to hours and reports an open session", async () => {
  const { store } = fakeStore(() => ({ rows: [{ sessions: "2", seconds: "5400", open_session: true }] }));
  assert.deepEqual(await store.projectUsageSummary("p1", 30), { windowDays: 30, sessions: 2, hours: 1.5, openSession: true });
});

test("space usage requires an active membership", async () => {
  const { store } = fakeStore(() => ({ rows: [] }));
  assert.equal(await store.spaceUsageSummary("outsider", "s1", 30), null);
});

test("invitations are created only by space owners and admins", async () => {
  const { store, queries } = fakeStore(() => ({ rows: [] }));
  await assert.rejects(() => store.createSpaceInvitation("member-1", "s1", "A@Example.com", "member"), /Team management denied/);
  const insert = queries.at(-1);
  assert.match(insert?.sql ?? "", /sm\.role IN \('owner', 'admin'\)/);
  assert.equal(insert?.values?.[2], "A@Example.com");
});

test("accepting an invitation is limited to the invited email and does not downgrade roles", async () => {
  const { store, queries } = fakeStore((sql) => (sql.includes("UPDATE mlbox_space_invitations") ? { rows: [{ space_id: "s1", role: "member" }] } : { rows: [] }));
  await store.acceptSpaceInvitation("u2", "b@example.com", "inv-1");
  const update = queries.find((q) => q.sql.includes("UPDATE mlbox_space_invitations"));
  assert.match(update?.sql ?? "", /lower\(email\) = lower\(\$3\)/);
  const insert = queries.find((q) => q.sql.includes("INSERT INTO mlbox_space_memberships"));
  assert.match(insert?.sql ?? "", /ON CONFLICT \(space_id, user_id\) DO NOTHING/);
});

test("project deletion is soft: usage history is kept, the Project is marked deleted, all in one transaction", async () => {
  const { store, queries } = fakeStore(() => ({ rows: [] }));
  await store.deleteProject("p1");
  const statements = queries.map((query) => query.sql.trim());
  assert.equal(statements[0], "BEGIN");
  assert.match(statements[1], /UPDATE mlbox_usage_sessions SET ended_at = now\(\)/);
  assert.doesNotMatch(statements.join("\n"), /DELETE FROM mlbox_usage_sessions/);
  assert.match(statements[2], /DELETE FROM mlbox_artifacts/);
  assert.match(statements[3], /DELETE FROM mlbox_sandboxes/);
  assert.match(statements[4], /UPDATE mlbox_projects SET deleted_at = now\(\)/);
  assert.doesNotMatch(statements.join("\n"), /DELETE FROM mlbox_projects/);
  assert.equal(statements[5], "COMMIT");
});
