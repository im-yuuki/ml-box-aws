// Runs every console query against a real PostgreSQL that was seeded by integration/seed.mjs.
// Usage (after `npm run build`): TEST_DATABASE_URL=postgres://... node integration/db-integration.mjs
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";

const url = process.env.TEST_DATABASE_URL;
if (!url) throw new Error("Set TEST_DATABASE_URL");

const require = createRequire(import.meta.url);
const pg = require("pg");
const dist = (name) => import(pathToFileURL(resolve(import.meta.dirname, "..", "dist", name)).href);
const queries = await dist("db.js");

// Same session setting as the console's own pool: a read must never be able to write.
const pool = new pg.Pool({ connectionString: url, max: 2, options: "-c default_transaction_read_only=on" });
test.after(() => pool.end());

test("overview counts users, spaces, projects, sessions, plans and units", async () => {
  const overview = await queries.loadDbOverview(pool);
  assert.equal(overview.users, 3);
  assert.equal(overview.spaces, 4);
  assert.equal(overview.organizationSpaces, 1);
  assert.equal(overview.projects, 3, "the soft-deleted project is not counted");
  assert.equal(overview.openSessions, 2);
  assert.deepEqual(overview.sandboxesByState, { running: 1, stopped: 1, failed: 1 });
  assert.deepEqual(overview.plans, { personal_plus: 1 }, "only active subscriptions count");
  assert.ok(overview.unitsThisMonth > 20, `units this month: ${overview.unitsThisMonth}`);
});

test("sandboxes list the metering one first and carry owner, space and profile", async () => {
  const rows = await queries.loadSandboxes(pool);
  assert.equal(rows.length, 3);
  assert.deepEqual(rows.map((row) => Boolean(row.session_started_at)), [true, true, false], "the sandboxes with an open session come first");
  const demo = rows.find((row) => row.project_name === "demo");
  assert.equal(demo.owner_email, "alice@example.com");
  assert.equal(demo.space_type, "personal");
  assert.equal(demo.profile, "g1.xlarge");
  assert.equal(Number(demo.units_per_hour), 10);
});

test("open sessions are ordered oldest first with their age", async () => {
  const rows = await queries.loadOpenSessions(pool);
  assert.equal(rows.length, 2);
  assert.ok(Number(rows[0].age_seconds) > 29 * 3600, "the 30 hour session comes first");
});

test("user search finds by email, name and id, and returns spaces with plan and units", async () => {
  const byEmail = await queries.searchUsers(pool, "ALICE@");
  assert.equal(byEmail.length, 1);
  assert.equal(byEmail[0].active_logins, "2", "the revoked session is not counted");
  assert.equal(byEmail[0].hub_identity_status, "mapped");
  assert.equal(byEmail[0].spaces.length, 2);
  const plus = byEmail[0].spaces.find((space) => space.space_id === "personal:u-alice");
  assert.equal(plus.plan, "personal_plus");
  assert.equal(plus.projects, "1");
  assert.ok(plus.units_this_month > 0);
  assert.equal((await queries.searchUsers(pool, "Bob Tran")).length, 1);
  assert.equal((await queries.searchUsers(pool, "u-carol")).length, 1);
  assert.equal((await queries.searchUsers(pool, "no-such-person")).length, 0);
});

test("user search treats LIKE wildcards in the query as plain characters", async () => {
  assert.equal((await queries.searchUsers(pool, "%%")).length, 0);
  assert.equal((await queries.searchUsers(pool, "a_ice")).length, 0);
});

test("audit events filter by action and the action list is counted", async () => {
  assert.equal((await queries.loadAuditEvents(pool, { limit: 10 })).length, 2);
  const filtered = await queries.loadAuditEvents(pool, { action: "sandbox_stopped", limit: 10 });
  assert.equal(filtered.length, 1);
  assert.equal(filtered[0].actor_email, "alice@example.com");
  const actions = await queries.loadAuditActions(pool);
  assert.equal(actions.length, 2);
});

test("the console pool cannot write", async () => {
  await assert.rejects(pool.query(`UPDATE mlbox_users SET email = 'x' WHERE id = 'u-alice'`), /read-only transaction/);
});

test("billing lists every Space with its plan, owner and units this month", async () => {
  const rows = await queries.loadBillingSpaces(pool);
  assert.equal(rows.length, 4);
  const org = rows.find((row) => row.id === "org-data");
  assert.equal(org.status, "past_due");
  assert.equal(org.owner_email, "alice@example.com");
  assert.equal(org.units_this_month, 25, "a 30 hour session is capped at 24 hours, plus one closed hour");
  const bob = rows.find((row) => row.id === "personal:u-bob");
  assert.equal(bob.plan, null, "a Space without a subscription has no plan row");
  assert.equal(bob.units_this_month, 0);
  assert.ok(rows.find((row) => row.id === "personal:u-alice").units_this_month > 25);
});

test("payments list the newest first with the Space name", async () => {
  const rows = await queries.loadRecentPayments(pool);
  assert.equal(rows.length, 2);
  assert.equal(rows[0].status, "failed");
  assert.equal(rows[0].space_name, "Data team");
});

test("units of the last 30 days add up the sessions with their rate", async () => {
  const units = await queries.loadUnitsLast30Days(pool);
  assert.ok(units > 50 && units < 53, `units: ${units}`);
});

test("storage counts ready bytes and finds uploads stuck in pending", async () => {
  const rows = await queries.loadStorageProjects(pool);
  const demo = rows.find((row) => row.project_name === "demo");
  assert.equal(demo.ready_count, "2");
  assert.equal(demo.ready_bytes, "12000000");
  assert.equal(demo.pending_count, "1");
  assert.equal(demo.stuck_count, "1");
  const gone = rows.find((row) => row.project_id === "p3");
  assert.ok(gone.project_deleted_at, "deleted Projects are listed so their leftovers can be found");
  assert.equal(gone.ready_bytes, "0", "a deleted artifact is not counted");
  assert.equal(rows[0].project_name, "demo", "largest first");
});

test("space plans list every Space with its subscription", async () => {
  const rows = await queries.loadSpacePlans(pool);
  assert.equal(rows.length, 4);
  assert.equal(rows.find((row) => row.id === "personal:u-carol").status, "pending");
});
