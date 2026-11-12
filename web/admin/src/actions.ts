import { randomUUID } from "node:crypto";

import type pg from "pg";

import { entitlementsFor, findPlan } from "./plans.js";

// The only code in the console that changes anything. Every action is audited before it runs (an audit that cannot be
// written stops the action), needs a written reason, and is switched on separately from the read-only console.

export const REASON_MIN = 5;
export const REASON_MAX = 300;

export class ActionError extends Error {
  constructor(
    readonly code: "INVALID" | "NOT_FOUND" | "UNAVAILABLE" | "UPSTREAM",
    message: string,
  ) {
    super(message);
    this.name = "ActionError";
  }
}

/** The reason of an action, trimmed, or null when it is missing or out of bounds. */
export function validateReason(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const reason = value.trim();
  return reason.length >= REASON_MIN && reason.length <= REASON_MAX ? reason : null;
}

export type HubClient = { stopServer: (username: string, serverName: string) => Promise<number> };
export type CognitoAdmin = { disable: (username: string) => Promise<void>; enable: (username: string) => Promise<void>; signOut: (username: string) => Promise<void> };
export type ActionDeps = { pool: pg.Pool; hub: HubClient | null; cognito: CognitoAdmin | null };
export type ActionContext = { ip: string; reason: string };

export async function ensureAdminAuditTable(pool: pg.Pool): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS mlbox_admin_audit (
      id text PRIMARY KEY,
      created_at timestamptz NOT NULL DEFAULT now(),
      ip text NOT NULL,
      action text NOT NULL,
      target text NOT NULL,
      reason text NOT NULL,
      outcome text NOT NULL CHECK (outcome IN ('started', 'succeeded', 'failed')),
      detail jsonb NOT NULL DEFAULT '{}'::jsonb
    );
    CREATE INDEX IF NOT EXISTS mlbox_admin_audit_created_idx ON mlbox_admin_audit(created_at DESC);`);
}

async function audited(
  deps: ActionDeps,
  context: ActionContext,
  action: string,
  target: string,
  run: () => Promise<Record<string, unknown>>,
): Promise<{ auditId: string; detail: Record<string, unknown> }> {
  const auditId = randomUUID();
  // Fail closed: when the record of the attempt cannot be stored, nothing is done.
  await deps.pool.query(`INSERT INTO mlbox_admin_audit (id, ip, action, target, reason, outcome) VALUES ($1, $2, $3, $4, $5, 'started')`, [auditId, context.ip, action, target, context.reason]);
  try {
    const detail = await run();
    await deps.pool.query(`UPDATE mlbox_admin_audit SET outcome = 'succeeded', detail = $2::jsonb WHERE id = $1`, [auditId, JSON.stringify(detail)]);
    return { auditId, detail };
  } catch (error) {
    await deps.pool
      .query(`UPDATE mlbox_admin_audit SET outcome = 'failed', detail = $2::jsonb WHERE id = $1`, [auditId, JSON.stringify({ error: error instanceof Error ? error.message : "error" })])
      .catch(() => undefined);
    throw error;
  }
}

const SERVER_NAME = /^[a-z0-9][a-z0-9-]{0,62}$/i;

/** Stops the sandbox of a Project in the Hub and closes its open usage sessions, as the BFF does when a user stops it. */
export function stopSandbox(deps: ActionDeps, context: ActionContext, projectId: string) {
  return audited(deps, context, "sandbox.stop", projectId, async () => {
    if (!deps.hub) throw new ActionError("UNAVAILABLE", "The Hub is not configured (HUB_URL, HUB_API_TOKEN)");
    const found = await deps.pool.query(`SELECT hub_username, server_name FROM mlbox_sandboxes WHERE project_id = $1`, [projectId]);
    const sandbox = found.rows[0];
    if (!sandbox) throw new ActionError("NOT_FOUND", "No sandbox for this project");
    const serverName = String(sandbox.server_name);
    if (!SERVER_NAME.test(serverName)) throw new ActionError("INVALID", "Unexpected server name");

    const status = await deps.hub.stopServer(String(sandbox.hub_username), serverName);
    // 404: the Hub no longer has the server, which is the state that was asked for.
    if (![200, 202, 204, 404].includes(status)) throw new ActionError("UPSTREAM", `The Hub answered ${status}`);

    const client = await deps.pool.connect();
    try {
      await client.query("BEGIN");
      const closed = await client.query(`UPDATE mlbox_usage_sessions SET ended_at = now() WHERE project_id = $1 AND ended_at IS NULL RETURNING id`, [projectId]);
      await client.query(`UPDATE mlbox_sandboxes SET state = 'stopped' WHERE project_id = $1`, [projectId]);
      await client.query("COMMIT");
      return { hubStatus: status, closedSessions: closed.rowCount ?? 0 };
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  });
}

async function requireUser(pool: pg.Pool, userId: string): Promise<string> {
  const found = await pool.query(`SELECT email FROM mlbox_users WHERE id = $1`, [userId]);
  if (!found.rows[0]) throw new ActionError("NOT_FOUND", "No such user");
  return String(found.rows[0].email);
}

async function revokeAll(pool: pg.Pool, userId: string): Promise<number> {
  const result = await pool.query(`UPDATE mlbox_auth_sessions SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL RETURNING session_id`, [userId]);
  return result.rowCount ?? 0;
}

/** Signs the user out everywhere on the dashboard. The account stays usable: they can sign in again. */
export function revokeSessions(deps: ActionDeps, context: ActionContext, userId: string) {
  return audited(deps, context, "user.revoke_sessions", userId, async () => {
    await requireUser(deps.pool, userId);
    return { revoked: await revokeAll(deps.pool, userId) };
  });
}

/** Disabling also ends every session, so the lock takes effect at once. */
export function setAccountEnabled(deps: ActionDeps, context: ActionContext, userId: string, enabled: boolean) {
  return audited(deps, context, enabled ? "user.enable" : "user.disable", userId, async () => {
    if (!deps.cognito) throw new ActionError("UNAVAILABLE", "Cognito is not configured (COGNITO_USER_POOL_ID)");
    await requireUser(deps.pool, userId);
    if (enabled) {
      await deps.cognito.enable(userId);
      return { enabled: true };
    }
    await deps.cognito.disable(userId);
    await deps.cognito.signOut(userId);
    return { enabled: false, revoked: await revokeAll(deps.pool, userId) };
  });
}

/**
 * Moves a Space to a plan, the way the mock checkout does: the active subscription and the entitlement rows change.
 * The BFF reads limits from the plan, so this is also how to give a Space more compute units.
 */
export function setSpacePlan(deps: ActionDeps, context: ActionContext, spaceId: string, planId: string) {
  return audited(deps, context, "space.set_plan", spaceId, async () => {
    const plan = findPlan(planId);
    if (!plan) throw new ActionError("INVALID", "Unknown plan");
    const space = await deps.pool.query(`SELECT type FROM mlbox_spaces WHERE id = $1`, [spaceId]);
    if (!space.rows[0]) throw new ActionError("NOT_FOUND", "No such Space");
    if (space.rows[0].type !== plan.spaceType) throw new ActionError("INVALID", `The plan ${plan.id} is for ${plan.spaceType} Spaces`);

    const client = await deps.pool.connect();
    try {
      await client.query("BEGIN");
      const before = await client.query(`SELECT plan, status FROM mlbox_space_subscriptions WHERE space_id = $1`, [spaceId]);
      await client.query(
        `INSERT INTO mlbox_space_subscriptions (space_id, plan, status, provider, payment_id, started_at, current_period_end)
         VALUES ($1, $2, 'active', 'mock', NULL, now(), now() + interval '1 month')
         ON CONFLICT (space_id) DO UPDATE SET plan = EXCLUDED.plan, status = 'active', provider = 'mock', payment_id = NULL,
           current_period_end = EXCLUDED.current_period_end, updated_at = now()`,
        [spaceId, plan.id],
      );
      for (const [resource, limit] of Object.entries(entitlementsFor(plan))) {
        await client.query(
          `INSERT INTO mlbox_space_entitlements (space_id, resource, limit_value, source_plan) VALUES ($1, $2, $3, $4)
           ON CONFLICT (space_id, resource) DO UPDATE SET limit_value = EXCLUDED.limit_value, source_plan = EXCLUDED.source_plan, updated_at = now()`,
          [spaceId, resource, limit, plan.id],
        );
      }
      await client.query("COMMIT");
      return { from: before.rows[0] ? { plan: before.rows[0].plan, status: before.rows[0].status } : null, to: plan.id };
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  });
}

export async function loadAdminAudit(db: { query: (text: string, values?: unknown[]) => Promise<{ rows: Record<string, unknown>[] }> }) {
  try {
    const result = await db.query(`SELECT id, created_at, ip, action, target, reason, outcome, detail FROM mlbox_admin_audit ORDER BY created_at DESC LIMIT 50`);
    return result.rows;
  } catch (error) {
    // 42P01: the table does not exist yet because actions were never switched on.
    if (typeof error === "object" && error !== null && (error as { code?: string }).code === "42P01") return [];
    throw error;
  }
}
