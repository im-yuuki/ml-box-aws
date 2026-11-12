// Creates the real schema (through the BFF's own AppStore, so it cannot drift) and fills it with a small,
// deterministic data set for the console queries. Usage: TEST_DATABASE_URL=postgres://... node integration/seed.mjs
// Needs the BFF built first: (cd ../bff && npm ci && npm run build).
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";

const url = process.env.TEST_DATABASE_URL;
if (!url) throw new Error("Set TEST_DATABASE_URL");

const bffRoot = resolve(import.meta.dirname, "..", "..", "bff");
const requireFromBff = createRequire(resolve(bffRoot, "package.json"));
const pg = requireFromBff("pg");
const { AppStore } = await import(pathToFileURL(resolve(bffRoot, "dist", "app-store.js")).href);

const pool = new pg.Pool({ connectionString: url, max: 2 });
await new AppStore(pool).ensureSchema();

const q = (text, values) => pool.query(text, values);
const ago = (minutes) => new Date(Date.now() - minutes * 60_000).toISOString();

await q(`TRUNCATE mlbox_artifacts, mlbox_usage_sessions, mlbox_sandboxes, mlbox_project_access, mlbox_projects, mlbox_team_members, mlbox_teams,
  mlbox_space_memberships, mlbox_space_subscriptions, mlbox_space_entitlements, mlbox_payment_transactions, mlbox_audit_events,
  mlbox_auth_sessions, mlbox_hub_identities, mlbox_spaces, mlbox_users CASCADE`);

for (const [id, email, name] of [["u-alice", "alice@example.com", "Alice Nguyen"], ["u-bob", "bob@example.com", "Bob Tran"], ["u-carol", "carol@example.com", null]]) {
  await q(`INSERT INTO mlbox_users (id, email, full_name, created_at) VALUES ($1, $2, $3, $4)`, [id, email, name, ago(60 * 24 * 30)]);
}
await q(`INSERT INTO mlbox_hub_identities (user_id, hub_username, status) VALUES ('u-alice', 'alice-hub', 'mapped'), ('u-bob', 'bob-hub', 'conflict')`);

for (const [id, type, name] of [["personal:u-alice", "personal", "Alice"], ["personal:u-bob", "personal", "Bob"], ["personal:u-carol", "personal", "Carol"], ["org-data", "organization", "Data team"]]) {
  await q(`INSERT INTO mlbox_spaces (id, type, name) VALUES ($1, $2, $3)`, [id, type, name]);
}
for (const [space, user, role] of [["personal:u-alice", "u-alice", "owner"], ["personal:u-bob", "u-bob", "owner"], ["personal:u-carol", "u-carol", "owner"], ["org-data", "u-alice", "owner"], ["org-data", "u-bob", "member"]]) {
  await q(`INSERT INTO mlbox_space_memberships (space_id, user_id, role) VALUES ($1, $2, $3)`, [space, user, role]);
}
for (const [id, space, name] of [["t-alice", "personal:u-alice", "Personal"], ["t-bob", "personal:u-bob", "Personal"], ["t-org", "org-data", "Default"]]) {
  await q(`INSERT INTO mlbox_teams (id, space_id, name) VALUES ($1, $2, $3)`, [id, space, name]);
}
for (const [id, team, name, by, deleted] of [["p1", "t-alice", "demo", "u-alice", null], ["p2", "t-org", "training", "u-alice", null], ["p3", "t-bob", "gone", "u-bob", ago(100)], ["p4", "t-bob", "scratch", "u-bob", null]]) {
  await q(`INSERT INTO mlbox_projects (id, team_id, name, created_by, deleted_at) VALUES ($1, $2, $3, $4, $5)`, [id, team, name, by, deleted]);
}
for (const [id, project, owner, hub, server, profile, state] of [
  ["sb1", "p1", "u-alice", "alice-hub", "p1", "g1.xlarge", "running"],
  ["sb2", "p2", "u-alice", "alice-hub", "p2", "c1.small", "stopped"],
  ["sb4", "p4", "u-bob", "bob-hub", "p4", "c1.small", "failed"],
]) {
  await q(`INSERT INTO mlbox_sandboxes (id, project_id, owner_user_id, hub_username, server_name, profile, state) VALUES ($1, $2, $3, $4, $5, $6, $7)`, [id, project, owner, hub, server, profile, state]);
}

// Sessions: one open GPU session (95 min), one open for 30 h, closed ones this month.
for (const [id, space, project, by, startedMinutesAgo, endedMinutesAgo, rate] of [
  ["us1", "personal:u-alice", "p1", "u-alice", 95, null, 10],
  ["us2", "org-data", "p2", "u-alice", 30 * 60, null, 1],
  ["us3", "personal:u-alice", "p1", "u-alice", 300, 240, 10],
  ["us4", "org-data", "p2", "u-bob", 600, 540, 1],
]) {
  await q(`INSERT INTO mlbox_usage_sessions (id, space_id, project_id, started_by, started_at, ended_at, units_per_hour) VALUES ($1, $2, $3, $4, $5, $6, $7)`, [id, space, project, by, ago(startedMinutesAgo), endedMinutesAgo === null ? null : ago(endedMinutesAgo), rate]);
}

await q(`INSERT INTO mlbox_space_subscriptions (space_id, plan, status, provider, current_period_end) VALUES
  ('personal:u-alice', 'personal_plus', 'active', 'mock', now() + interval '20 days'),
  ('org-data', 'org_team', 'past_due', 'mock', now() - interval '2 days'),
  ('personal:u-carol', 'personal_pro', 'pending', 'mock', NULL)`);
for (const [space, resource, limit, plan] of [["personal:u-alice", "credits", 100, "personal_plus"], ["personal:u-alice", "storage_gb", 25, "personal_plus"], ["org-data", "credits", 300, "org_team"], ["org-data", "storage_gb", 100, "org_team"]]) {
  await q(`INSERT INTO mlbox_space_entitlements (space_id, resource, limit_value, source_plan) VALUES ($1, $2, $3, $4)`, [space, resource, limit, plan]);
}
for (const [id, space, plan, cents, status, by, minutes] of [["pay1", "personal:u-alice", "personal_plus", 800, "succeeded", "u-alice", 3000], ["pay2", "org-data", "org_team", 1900, "failed", "u-alice", 120]]) {
  await q(`INSERT INTO mlbox_payment_transactions (id, space_id, plan_id, amount_cents, payment_method, status, idempotency_key, created_by, created_at) VALUES ($1, $2, $3, $4, 'mock_card', $5, $1, $6, $7)`, [id, space, plan, cents, status, by, ago(minutes)]);
}
await q(`INSERT INTO mlbox_audit_events (id, space_id, actor_user_id, action, target, metadata, created_at) VALUES
  ('a1', 'personal:u-alice', 'u-alice', 'project.sandbox_stopped', 'p1', '{}', now() - interval '5 minutes'),
  ('a2', 'org-data', 'u-bob', 'subscription.mock_activated', 'org_team', '{}', now() - interval '1 day')`);
await q(`INSERT INTO mlbox_auth_sessions (session_id, user_id, user_agent, last_seen_at, revoked_at) VALUES
  ('s-a1', 'u-alice', 'Chrome', now() - interval '12 minutes', NULL),
  ('s-a2', 'u-alice', 'Firefox', now() - interval '2 days', NULL),
  ('s-a3', 'u-alice', 'Old', now() - interval '9 days', now() - interval '8 days')`);
for (const [id, project, size, status, minutes, deleted] of [
  ["ar1", "p1", 5_000_000, "ready", 600, null],
  ["ar2", "p1", 7_000_000, "ready", 500, null],
  ["ar3", "p1", 1_000, "pending", 300, null],
  ["ar4", "p2", 2_000_000, "ready", 100, null],
  ["ar5", "p3", 9_000_000, "ready", 900, ago(50)],
]) {
  await q(`INSERT INTO mlbox_artifacts (id, project_id, name, object_key, content_type, size_bytes, status, created_by, created_at, deleted_at) VALUES ($1, $2, $1, $3, 'text/plain', $4, $5, 'u-alice', $6, $7)`, [id, project, `spaces/x/projects/${project}/${id}`, size, status, ago(minutes), deleted]);
}
await pool.end();
console.log("seeded");
