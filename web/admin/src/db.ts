import { readFileSync } from "node:fs";
import pg from "pg";

import type { AdminConfig } from "./config.js";

export type Queryable = { query: (text: string, values?: unknown[]) => Promise<{ rows: Record<string, unknown>[] }> };

/** The pool is read-only at the session level, so a bug here cannot change customer data. */
export function createPool(config: Pick<AdminConfig, "databaseUrl" | "databaseCaPath">): pg.Pool | null {
  if (!config.databaseUrl) return null;
  return new pg.Pool({
    connectionString: config.databaseUrl,
    max: 3,
    connectionTimeoutMillis: 5000,
    statement_timeout: 10000,
    options: "-c default_transaction_read_only=on",
    ssl: config.databaseCaPath ? { ca: readFileSync(config.databaseCaPath, "utf8"), rejectUnauthorized: true } : undefined,
  });
}

const MONTH_START = "date_trunc('month', now())";

// Compute units consumed in the current month by a session, capped at 24 hours like the BFF meter does.
const UNITS_EXPR = `LEAST(extract(epoch FROM (coalesce(s.ended_at, now()) - GREATEST(s.started_at, ${MONTH_START}))), 86400) / 3600.0 * s.units_per_hour`;

export type DbOverview = {
  users: number;
  spaces: number;
  organizationSpaces: number;
  projects: number;
  sandboxesByState: Record<string, number>;
  openSessions: number;
  plans: Record<string, number>;
  unitsThisMonth: number;
};

export async function loadDbOverview(db: Queryable): Promise<DbOverview> {
  const [counts, states, plans, units] = await Promise.all([
    db.query(`SELECT
        (SELECT count(*) FROM mlbox_users) AS users,
        (SELECT count(*) FROM mlbox_spaces) AS spaces,
        (SELECT count(*) FROM mlbox_spaces WHERE type = 'organization') AS org_spaces,
        (SELECT count(*) FROM mlbox_projects WHERE deleted_at IS NULL) AS projects,
        (SELECT count(*) FROM mlbox_usage_sessions WHERE ended_at IS NULL) AS open_sessions`),
    db.query(`SELECT state, count(*) AS count FROM mlbox_sandboxes GROUP BY state`),
    db.query(`SELECT plan, count(*) AS count FROM mlbox_space_subscriptions WHERE status = 'active' GROUP BY plan`),
    db.query(`SELECT coalesce(sum(${UNITS_EXPR}), 0) AS units FROM mlbox_usage_sessions s WHERE coalesce(s.ended_at, now()) >= ${MONTH_START}`),
  ]);
  const row = counts.rows[0] ?? {};
  return {
    users: Number(row.users ?? 0),
    spaces: Number(row.spaces ?? 0),
    organizationSpaces: Number(row.org_spaces ?? 0),
    projects: Number(row.projects ?? 0),
    openSessions: Number(row.open_sessions ?? 0),
    sandboxesByState: Object.fromEntries(states.rows.map((item) => [String(item.state), Number(item.count)])),
    plans: Object.fromEntries(plans.rows.map((item) => [String(item.plan), Number(item.count)])),
    unitsThisMonth: Math.round(Number(units.rows[0]?.units ?? 0) * 10) / 10,
  };
}

export async function loadSandboxes(db: Queryable) {
  const result = await db.query(`
    SELECT sb.id, sb.profile, sb.state, sb.hub_username, sb.server_name, sb.created_at,
           p.id AS project_id, p.name AS project_name, p.deleted_at,
           sp.id AS space_id, sp.name AS space_name, sp.type AS space_type,
           u.email AS owner_email,
           os.started_at AS session_started_at, os.units_per_hour
      FROM mlbox_sandboxes sb
      JOIN mlbox_projects p ON p.id = sb.project_id
      JOIN mlbox_teams t ON t.id = p.team_id
      JOIN mlbox_spaces sp ON sp.id = t.space_id
      JOIN mlbox_users u ON u.id = sb.owner_user_id
      LEFT JOIN LATERAL (
        SELECT started_at, units_per_hour FROM mlbox_usage_sessions
         WHERE project_id = p.id AND ended_at IS NULL ORDER BY started_at DESC LIMIT 1
      ) os ON true
     ORDER BY (os.started_at IS NOT NULL) DESC, sb.created_at DESC
     LIMIT 200`);
  return result.rows;
}

export async function loadOpenSessions(db: Queryable) {
  const result = await db.query(`
    SELECT s.id, s.started_at, s.units_per_hour, p.name AS project_name, sp.name AS space_name, u.email AS started_by,
           extract(epoch FROM (now() - s.started_at)) AS age_seconds
      FROM mlbox_usage_sessions s
      JOIN mlbox_projects p ON p.id = s.project_id
      JOIN mlbox_spaces sp ON sp.id = s.space_id
      JOIN mlbox_users u ON u.id = s.started_by
     WHERE s.ended_at IS NULL
     ORDER BY s.started_at ASC
     LIMIT 100`);
  return result.rows;
}

export async function searchUsers(db: Queryable, query: string) {
  const pattern = `%${query.replace(/[\\%_]/g, (character) => `\\${character}`)}%`;
  const users = await db.query(
    `SELECT u.id, u.email, u.full_name, u.created_at,
            (SELECT max(last_seen_at) FROM mlbox_auth_sessions a WHERE a.user_id = u.id AND a.revoked_at IS NULL) AS last_seen_at,
            (SELECT count(*) FROM mlbox_auth_sessions a WHERE a.user_id = u.id AND a.revoked_at IS NULL) AS active_logins,
            hi.hub_username, hi.status AS hub_identity_status
       FROM mlbox_users u
       LEFT JOIN mlbox_hub_identities hi ON hi.user_id = u.id
      WHERE u.email ILIKE $1 ESCAPE '\\' OR u.full_name ILIKE $1 ESCAPE '\\' OR u.id = $2
      ORDER BY u.created_at DESC
      LIMIT 20`,
    [pattern, query],
  );
  const ids = users.rows.map((row) => String(row.id));
  if (ids.length === 0) return [];
  const spaces = await db.query(
    `SELECT m.user_id, m.role, m.status, sp.id AS space_id, sp.name AS space_name, sp.type AS space_type,
            sub.plan, sub.status AS plan_status,
            (SELECT count(*) FROM mlbox_teams t JOIN mlbox_projects p ON p.team_id = t.id
              WHERE t.space_id = sp.id AND p.deleted_at IS NULL) AS projects,
            (SELECT coalesce(sum(${UNITS_EXPR}), 0) FROM mlbox_usage_sessions s
              WHERE s.space_id = sp.id AND coalesce(s.ended_at, now()) >= ${MONTH_START}) AS units_this_month
       FROM mlbox_space_memberships m
       JOIN mlbox_spaces sp ON sp.id = m.space_id
       LEFT JOIN mlbox_space_subscriptions sub ON sub.space_id = sp.id
      WHERE m.user_id = ANY($1::text[])
      ORDER BY sp.type, sp.name`,
    [ids],
  );
  return users.rows.map((user) => ({
    ...user,
    spaces: spaces.rows
      .filter((space) => space.user_id === user.id)
      .map(({ user_id: _ignored, ...space }) => ({ ...space, units_this_month: Math.round(Number(space.units_this_month) * 10) / 10 })),
  }));
}

export async function loadAuditEvents(db: Queryable, options: { action?: string; limit: number }) {
  const result = await db.query(
    `SELECT e.id, e.created_at, e.action, e.target, e.metadata, u.email AS actor_email, sp.name AS space_name
       FROM mlbox_audit_events e
       JOIN mlbox_users u ON u.id = e.actor_user_id
       JOIN mlbox_spaces sp ON sp.id = e.space_id
      WHERE ($1::text IS NULL OR e.action ILIKE $1 ESCAPE '\\')
      ORDER BY e.created_at DESC
      LIMIT $2`,
    [options.action ? `%${options.action.replace(/[\\%_]/g, (character) => `\\${character}`)}%` : null, options.limit],
  );
  return result.rows;
}

export async function loadAuditActions(db: Queryable) {
  const result = await db.query(`SELECT action, count(*) AS count FROM mlbox_audit_events GROUP BY action ORDER BY count DESC LIMIT 40`);
  return result.rows.map((row) => ({ action: String(row.action), count: Number(row.count) }));
}
