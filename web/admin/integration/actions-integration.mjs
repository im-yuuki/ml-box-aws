// Runs the console actions against a real PostgreSQL, with a fake Hub and a fake Cognito. It re-seeds first, so it
// changes the data of that database. Usage (after `npm run build`): TEST_DATABASE_URL=postgres://... node integration/actions-integration.mjs
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";

const url = process.env.TEST_DATABASE_URL;
if (!url) throw new Error("Set TEST_DATABASE_URL");
execFileSync(process.execPath, [resolve(import.meta.dirname, "seed.mjs")], { env: process.env, stdio: "inherit" });

const require = createRequire(import.meta.url);
const pg = require("pg");
const actions = await import(pathToFileURL(resolve(import.meta.dirname, "..", "dist", "actions.js")).href);

const pool = new pg.Pool({ connectionString: url, max: 3 });
await actions.ensureAdminAuditTable(pool);
test.after(() => pool.end());

const calls = [];
const hub = { stopServer: async (username, serverName) => (calls.push(["hub", username, serverName]), hubStatus) };
const cognito = {
  disable: async (username) => calls.push(["disable", username]),
  enable: async (username) => calls.push(["enable", username]),
  signOut: async (username) => calls.push(["signOut", username]),
};
let hubStatus = 202;
const deps = { pool, hub, cognito };
const context = { ip: "10.0.0.9", reason: "support ticket 123" };
const one = async (text, values) => (await pool.query(text, values)).rows[0];

test("a reason is required and bounded", () => {
  assert.equal(actions.validateReason("  too  "), null);
  assert.equal(actions.validateReason("four"), null);
  assert.equal(actions.validateReason("x".repeat(301)), null);
  assert.equal(actions.validateReason(42), null);
  assert.equal(actions.validateReason("  customer asked  "), "customer asked");
});

test("stopping a sandbox calls the Hub, closes the open session and records the audit", async () => {
  calls.length = 0;
  const result = await actions.stopSandbox(deps, context, "p1");
  assert.deepEqual(calls, [["hub", "alice-hub", "p1"]]);
  assert.equal(result.detail.closedSessions, 1);
  assert.equal((await one(`SELECT count(*) AS n FROM mlbox_usage_sessions WHERE project_id = 'p1' AND ended_at IS NULL`)).n, "0");
  assert.equal((await one(`SELECT state FROM mlbox_sandboxes WHERE project_id = 'p1'`)).state, "stopped");
  const audit = await one(`SELECT * FROM mlbox_admin_audit WHERE id = $1`, [result.auditId]);
  assert.equal(audit.outcome, "succeeded");
  assert.equal(audit.action, "sandbox.stop");
  assert.equal(audit.reason, "support ticket 123");
  assert.equal(audit.ip, "10.0.0.9");
});

test("a Hub that has already lost the server counts as stopped, any other error does not change the data", async () => {
  hubStatus = 404;
  await actions.stopSandbox(deps, context, "p2");
  assert.equal((await one(`SELECT count(*) AS n FROM mlbox_usage_sessions WHERE project_id = 'p2' AND ended_at IS NULL`)).n, "0");

  hubStatus = 500;
  await assert.rejects(actions.stopSandbox(deps, context, "p4"), /The Hub answered 500/);
  assert.equal((await one(`SELECT state FROM mlbox_sandboxes WHERE project_id = 'p4'`)).state, "failed", "nothing changed after the Hub failed");
  const failed = await one(`SELECT outcome, detail FROM mlbox_admin_audit WHERE target = 'p4' ORDER BY created_at DESC LIMIT 1`);
  assert.equal(failed.outcome, "failed");
  assert.match(failed.detail.error, /500/);
  hubStatus = 202;
});

test("an unknown project is refused and still audited", async () => {
  await assert.rejects(actions.stopSandbox(deps, context, "nope"), /No sandbox/);
  assert.equal((await one(`SELECT outcome FROM mlbox_admin_audit WHERE target = 'nope'`)).outcome, "failed");
});

test("revoking sessions ends every active login of the user and no one else's", async () => {
  const result = await actions.revokeSessions(deps, context, "u-alice");
  assert.equal(result.detail.revoked, 2);
  assert.equal((await one(`SELECT count(*) AS n FROM mlbox_auth_sessions WHERE user_id = 'u-alice' AND revoked_at IS NULL`)).n, "0");
  await assert.rejects(actions.revokeSessions(deps, context, "u-nobody"), /No such user/);
});

test("disabling an account locks it in Cognito, signs it out and revokes its sessions", async () => {
  await pool.query(`INSERT INTO mlbox_auth_sessions (session_id, user_id, user_agent) VALUES ('s-b1', 'u-bob', 'Chrome')`);
  calls.length = 0;
  const result = await actions.setAccountEnabled(deps, context, "u-bob", false);
  assert.deepEqual(calls, [["disable", "u-bob"], ["signOut", "u-bob"]]);
  assert.equal(result.detail.revoked, 1);
  calls.length = 0;
  await actions.setAccountEnabled(deps, context, "u-bob", true);
  assert.deepEqual(calls, [["enable", "u-bob"]]);
  await assert.rejects(actions.setAccountEnabled({ ...deps, cognito: null }, context, "u-bob", false), /Cognito is not configured/);
});

test("changing the plan of a Space writes the subscription and its entitlements in one step", async () => {
  const result = await actions.setSpacePlan(deps, context, "personal:u-bob", "personal_pro");
  assert.deepEqual(result.detail, { from: null, to: "personal_pro" });
  const subscription = await one(`SELECT plan, status FROM mlbox_space_subscriptions WHERE space_id = 'personal:u-bob'`);
  assert.deepEqual({ ...subscription }, { plan: "personal_pro", status: "active" });
  const entitlements = Object.fromEntries((await pool.query(`SELECT resource, limit_value FROM mlbox_space_entitlements WHERE space_id = 'personal:u-bob'`)).rows.map((row) => [row.resource, Number(row.limit_value)]));
  assert.deepEqual(entitlements, { credits: 300, concurrent_sandboxes: 5, storage_gb: 100, gpu_access: 1 });

  const upgrade = await actions.setSpacePlan(deps, context, "org-data", "org_growth");
  assert.deepEqual(upgrade.detail, { from: { plan: "org_team", status: "past_due" }, to: "org_growth" });
  assert.equal((await one(`SELECT status FROM mlbox_space_subscriptions WHERE space_id = 'org-data'`)).status, "active");
});

test("a plan of the wrong type, an unknown plan and an unknown Space are refused without changes", async () => {
  await assert.rejects(actions.setSpacePlan(deps, context, "org-data", "personal_pro"), /is for personal Spaces/);
  await assert.rejects(actions.setSpacePlan(deps, context, "personal:u-alice", "gold"), /Unknown plan/);
  await assert.rejects(actions.setSpacePlan(deps, context, "ghost", "personal_pro"), /No such Space/);
  assert.equal((await one(`SELECT plan FROM mlbox_space_subscriptions WHERE space_id = 'personal:u-alice'`)).plan, "personal_plus");
});

test("when the audit cannot be written nothing is done", async () => {
  calls.length = 0;
  const broken = { ...deps, pool: { query: async () => { throw new Error("db down"); }, connect: pool.connect.bind(pool) } };
  await assert.rejects(actions.stopSandbox(broken, context, "p1"), /db down/);
  assert.deepEqual(calls, [], "the Hub was not called");
});

test("the audit log is listed newest first", async () => {
  const rows = await actions.loadAdminAudit(pool);
  assert.ok(rows.length >= 8);
  assert.ok(new Date(rows[0].created_at) >= new Date(rows[rows.length - 1].created_at));
});

test("a reason in Vietnamese is stored as written", async () => {
  const reason = "khách đã thanh toán lại, ticket 456";
  const result = await actions.setSpacePlan(deps, { ip: "10.0.0.9", reason }, "personal:u-carol", "personal_pro");
  assert.equal((await one(`SELECT reason FROM mlbox_admin_audit WHERE id = $1`, [result.auditId])).reason, reason);
});
