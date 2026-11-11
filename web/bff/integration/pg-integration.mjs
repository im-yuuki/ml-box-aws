// Integration test: runs the BFF AppStore against a real PostgreSQL database.
// Usage: DATABASE_URL=postgres://... node integration/pg-integration.mjs
import assert from "node:assert/strict";
import pg from "pg";
import { AppStore, INVITATION_NOT_AVAILABLE, LAST_TEAM_LEAD, PROJECT_RUNTIME_OWNER_NOT_READY, TEAM_MANAGEMENT_DENIED } from "../dist/app-store.js";
import { buildArtifactObjectKey } from "../dist/artifacts.js";
import { unitsPerHourForRuntime } from "../dist/mock-billing.js";

const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL is required");

const pool = new pg.Pool({ connectionString: url, max: 4 });
const store = new AppStore(pool);

const results = [];
async function check(name, fn) {
  try {
    await fn();
    results.push(["PASS", name]);
  } catch (error) {
    results.push(["FAIL", `${name}: ${error.message}`]);
  }
}

async function expectReject(promise, pattern) {
  await assert.rejects(promise, (error) => {
    assert.match(String(error.message), pattern);
    return true;
  });
}

const OWNER = "owner-sub";
const MEMBER = "member-sub";
const VIEWER = "viewer-sub";
const NEWCOMER = "newcomer-sub";
const OUTSIDER = "outsider-sub";
const ORG = "org-1";

await check("schema bootstrap is idempotent", async () => {
  await store.ensureSchema();
  await store.ensureSchema();
});

await check("users bootstrap personal spaces", async () => {
  for (const [id, email] of [[OWNER, "owner@example.com"], [MEMBER, "member@example.com"], [VIEWER, "viewer@example.com"], [NEWCOMER, "newcomer@example.com"], [OUTSIDER, "outsider@example.com"]]) {
    await store.ensureUserBootstrap(id, email);
  }
});

// Organization space and memberships (created directly; the product has no self-serve org creation yet).
await pool.query(`INSERT INTO mlbox_spaces (id, type, name) VALUES ($1, 'organization', 'Acme') ON CONFLICT DO NOTHING`, [ORG]);
await pool.query(
  `INSERT INTO mlbox_space_memberships (space_id, user_id, role, status) VALUES
     ($1, $2, 'owner', 'active'), ($1, $3, 'member', 'active'), ($1, $4, 'viewer', 'active')
   ON CONFLICT DO NOTHING`,
  [ORG, OWNER, MEMBER, VIEWER],
);

let teamId;
let projectId;
let projectSpaceCheck;

await check("owner creates a team; space owner/admin only", async () => {
  const team = await store.createTeam(OWNER, ORG, "Data");
  teamId = team.id;
  await expectReject(store.createTeam(MEMBER, ORG, "Nope"), new RegExp(TEAM_MANAGEMENT_DENIED));
});

await check("team membership is required to create a project as a member", async () => {
  await expectReject(store.createProject(MEMBER, ORG, teamId, "P-before-membership"), /Project team access denied/);
  await store.addTeamMember(OWNER, ORG, teamId, MEMBER, "member");
  const project = await store.createProject(MEMBER, ORG, teamId, "Alpha");
  projectId = project.id;
  assert.equal(project.spaceId, ORG);
});

await check("viewers cannot create projects", async () => {
  await expectReject(store.createProject(VIEWER, ORG, teamId, "Nope"), /Project team access denied/);
});

await check("project listing shows team members and space viewers, hides outsiders", async () => {
  assert.deepEqual((await store.listProjects(MEMBER, ORG)).map((p) => p.id), [projectId]);
  assert.deepEqual((await store.listProjects(VIEWER, ORG)).map((p) => p.id), [projectId]);
  assert.deepEqual(await store.listProjects(OUTSIDER, ORG), []);
});

await check("blocked direct grant hides a project from a team member", async () => {
  await pool.query(`INSERT INTO mlbox_project_access (project_id, user_id, role, granted_by) VALUES ($1, $2, 'blocked', $3)`, [projectId, MEMBER, OWNER]);
  assert.deepEqual(await store.listProjects(MEMBER, ORG), []);
  assert.equal(await store.projectPermission(MEMBER, projectId), null);
  await pool.query(`DELETE FROM mlbox_project_access WHERE project_id = $1 AND user_id = $2`, [projectId, MEMBER]);
  assert.equal((await store.listProjects(MEMBER, ORG)).length, 1);
});

await check("last team lead cannot be removed or demoted", async () => {
  await store.addTeamMember(OWNER, ORG, teamId, OWNER, "lead");
  await expectReject(store.removeTeamMember(OWNER, ORG, teamId, OWNER), new RegExp(LAST_TEAM_LEAD));
  await expectReject(store.addTeamMember(OWNER, ORG, teamId, OWNER, "member"), new RegExp(LAST_TEAM_LEAD));
  await store.addTeamMember(OWNER, ORG, teamId, MEMBER, "lead");
  await store.addTeamMember(OWNER, ORG, teamId, OWNER, "member");
  const members = await store.listTeamMembers(MEMBER, ORG, teamId);
  assert.equal(members.find((m) => m.userId === MEMBER)?.role, "lead");
});

await check("invitations: only owners/admins create; invitee accepts with matching email only", async () => {
  await expectReject(store.createSpaceInvitation(VIEWER, ORG, "new@example.com", "member"), new RegExp(TEAM_MANAGEMENT_DENIED));
  const invitation = await store.createSpaceInvitation(OWNER, ORG, "newcomer@example.com", "member");
  assert.equal(invitation.status, "pending");
  assert.deepEqual((await store.listMyInvitations("newcomer@example.com")).map((i) => i.id), [invitation.id]);
  await expectReject(store.acceptSpaceInvitation(OUTSIDER, "outsider@example.com", invitation.id), new RegExp(INVITATION_NOT_AVAILABLE));
  await store.acceptSpaceInvitation(NEWCOMER, "newcomer@example.com", invitation.id);
  const role = (await pool.query(`SELECT role, status FROM mlbox_space_memberships WHERE space_id = $1 AND user_id = $2`, [ORG, NEWCOMER])).rows[0];
  assert.deepEqual(role, { role: "member", status: "active" });
});

await check("an accepted member joins the Space's teams and sees its projects", async () => {
  const team = (await pool.query(`SELECT tm.role FROM mlbox_team_members tm WHERE tm.team_id = $1 AND tm.user_id = $2`, [teamId, NEWCOMER])).rows[0];
  assert.equal(team.role, "member");
  assert.deepEqual((await store.listProjects(NEWCOMER, ORG)).map((p) => p.id), [projectId]);
  const permission = await store.projectPermission(NEWCOMER, projectId);
  assert.equal(permission?.canRead, true);
  assert.equal(permission?.canOperate, true);
});

await check("the schema backfills the team memberships of existing Space members", async () => {
  await pool.query(`DELETE FROM mlbox_team_members WHERE team_id = $1 AND user_id = $2`, [teamId, NEWCOMER]);
  assert.deepEqual(await store.listProjects(NEWCOMER, ORG), []);
  await store.ensureSchema();
  const team = (await pool.query(`SELECT tm.role FROM mlbox_team_members tm WHERE tm.team_id = $1 AND tm.user_id = $2`, [teamId, NEWCOMER])).rows[0];
  assert.equal(team.role, "member");
  assert.deepEqual((await store.listProjects(NEWCOMER, ORG)).map((p) => p.id), [projectId]);
});

await check("accepting an invitation never downgrades an existing owner", async () => {
  const invitation = await store.createSpaceInvitation(OWNER, ORG, "owner@example.com", "viewer");
  await store.acceptSpaceInvitation(OWNER, "owner@example.com", invitation.id);
  const role = (await pool.query(`SELECT role FROM mlbox_space_memberships WHERE space_id = $1 AND user_id = $2`, [ORG, OWNER])).rows[0];
  assert.equal(role.role, "owner");
});

await check("revoked invitations cannot be accepted", async () => {
  const invitation = await store.createSpaceInvitation(OWNER, ORG, "gone@example.com", "member");
  await store.revokeSpaceInvitation(OWNER, ORG, invitation.id);
  await expectReject(store.acceptSpaceInvitation(OUTSIDER, "gone@example.com", invitation.id), new RegExp(INVITATION_NOT_AVAILABLE));
});

await check("the member count of a Space covers the members and the pending invitations", async () => {
  const before = await store.spaceMemberCount(ORG);
  const invitation = await store.createSpaceInvitation(OWNER, ORG, "count@example.com", "member");
  assert.equal(await store.spaceMemberCount(ORG), before + 1);
  await store.revokeSpaceInvitation(OWNER, ORG, invitation.id);
  assert.equal(await store.spaceMemberCount(ORG), before);
});

await check("sandbox runtime needs the creator's Hub identity and runs under it", async () => {
  await expectReject(store.ensureProjectSandboxRuntime(projectId), new RegExp(PROJECT_RUNTIME_OWNER_NOT_READY));
  await store.upsertHubIdentity({ userId: MEMBER, hubUsername: "cognito-member-sub", legacyEmail: null, previousHubUsername: null, status: "mapped" });
  const runtime = await store.ensureProjectSandboxRuntime(projectId);
  assert.equal(runtime.ownerUserId, MEMBER);
  assert.equal(runtime.hubUsername, "cognito-member-sub");
  assert.equal(runtime.serverName, projectId);
});

await check("usage sessions open once, close on stop, and summarize", async () => {
  await store.openUsageSession(projectId, MEMBER, unitsPerHourForRuntime("cpuShared"));
  await store.openUsageSession(projectId, OWNER, unitsPerHourForRuntime("cpuShared"));
  const open = (await pool.query(`SELECT count(*)::int AS n FROM mlbox_usage_sessions WHERE project_id = $1 AND ended_at IS NULL`, [projectId])).rows[0].n;
  assert.equal(open, 1);
  await store.closeUsageSessions(projectId);
  const summary = await store.projectUsageSummary(projectId, 30);
  assert.equal(summary.sessions, 1);
  assert.equal(summary.openSession, false);
  const space = await store.spaceUsageSummary(MEMBER, ORG, 30);
  assert.equal(space.projects[0].projectId, projectId);
  assert.equal(await store.spaceUsageSummary(OUTSIDER, ORG, 30), null);
});

await check("artifact metadata is pending until completion and keys stay under the project prefix", async () => {
  projectSpaceCheck = await store.getProjectSpaceId(projectId);
  assert.equal(projectSpaceCheck, ORG);
  const artifactId = "00000000-0000-4000-8000-000000000001";
  const key = buildArtifactObjectKey(ORG, projectId, artifactId, "notes.md");
  const created = await store.createArtifact({ id: artifactId, projectId, name: "notes.md", objectKey: key, contentType: "text/markdown", sizeBytes: 12, createdBy: MEMBER });
  assert.equal(created.status, "pending");
  assert.equal((await store.listArtifacts(projectId)).length, 1);
  assert.equal(await store.markArtifactReady(projectId, artifactId), true);
  assert.equal((await store.getArtifact(projectId, artifactId)).status, "ready");
  assert.equal(await store.markArtifactReady(projectId, artifactId), false);
});

await store.close();

let failed = 0;
for (const [status, name] of results) {
  console.log(`${status} ${name}`);
  if (status === "FAIL") failed += 1;
}
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed === 0 ? 0 : 1);
