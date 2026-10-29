import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { resolveProjectPermission, type ProjectPermission } from "./access.js";

type AppQueryResult = { rows: Array<Record<string, unknown>> };

export type AppDatabase = {
  query: (text: string, values?: unknown[]) => Promise<AppQueryResult>;
  connect: () => Promise<{ query: (text: string, values?: unknown[]) => Promise<AppQueryResult>; release: () => void }>;
  end: () => Promise<void>;
};

export type SpaceRole = "owner" | "admin" | "member" | "viewer";
export type TeamRole = "lead" | "member";
export type ProjectRole = "manager" | "contributor" | "viewer" | "blocked";

export type BootstrapContext = {
  userId: string;
  email: string;
  personalSpaceId: string;
  defaultTeamId: string;
};

export type ProjectRecord = {
  id: string;
  spaceId: string;
  teamId: string;
  name: string;
  createdBy: string;
};

export type SubscriptionRecord = {
  spaceId: string;
  plan: string;
  status: string;
  provider: string;
};

export class AppStore {
  private readonly pool: AppDatabase;

  constructor(connectionString: string);
  constructor(database: AppDatabase);
  constructor(connectionStringOrDatabase: string | AppDatabase) {
    this.pool = typeof connectionStringOrDatabase === "string"
      ? new Pool({
          connectionString: connectionStringOrDatabase,
          ssl: { ca: readFileSync("/etc/ssl/certs/rds-ca-bundle.pem", "utf8"), rejectUnauthorized: true },
          max: 5,
          connectionTimeoutMillis: 3000,
          idleTimeoutMillis: 30_000,
        })
      : connectionStringOrDatabase;
  }

  async ensureSchema(): Promise<void> {
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS mlbox_users (
        id text PRIMARY KEY,
        email text NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now()
      );
      CREATE TABLE IF NOT EXISTS mlbox_spaces (
        id text PRIMARY KEY,
        type text NOT NULL CHECK (type IN ('personal', 'organization')),
        name text NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now()
      );
      CREATE TABLE IF NOT EXISTS mlbox_space_memberships (
        space_id text NOT NULL REFERENCES mlbox_spaces(id) ON DELETE CASCADE,
        user_id text NOT NULL REFERENCES mlbox_users(id) ON DELETE CASCADE,
        role text NOT NULL CHECK (role IN ('owner', 'admin', 'member', 'viewer')),
        status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'invited', 'revoked')),
        created_at timestamptz NOT NULL DEFAULT now(),
        PRIMARY KEY (space_id, user_id)
      );
      CREATE TABLE IF NOT EXISTS mlbox_teams (
        id text PRIMARY KEY,
        space_id text NOT NULL REFERENCES mlbox_spaces(id) ON DELETE CASCADE,
        name text NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now(),
        UNIQUE (space_id, name)
      );
      CREATE TABLE IF NOT EXISTS mlbox_team_members (
        team_id text NOT NULL REFERENCES mlbox_teams(id) ON DELETE CASCADE,
        user_id text NOT NULL REFERENCES mlbox_users(id) ON DELETE CASCADE,
        role text NOT NULL CHECK (role IN ('lead', 'member')),
        created_at timestamptz NOT NULL DEFAULT now(),
        PRIMARY KEY (team_id, user_id)
      );
      CREATE TABLE IF NOT EXISTS mlbox_projects (
        id text PRIMARY KEY,
        team_id text NOT NULL REFERENCES mlbox_teams(id) ON DELETE RESTRICT,
        name text NOT NULL,
        created_by text NOT NULL REFERENCES mlbox_users(id) ON DELETE RESTRICT,
        created_at timestamptz NOT NULL DEFAULT now(),
        UNIQUE (team_id, name)
      );
      CREATE TABLE IF NOT EXISTS mlbox_project_access (
        project_id text NOT NULL REFERENCES mlbox_projects(id) ON DELETE CASCADE,
        user_id text NOT NULL REFERENCES mlbox_users(id) ON DELETE CASCADE,
        role text NOT NULL CHECK (role IN ('manager', 'contributor', 'viewer', 'blocked')),
        granted_by text NOT NULL REFERENCES mlbox_users(id) ON DELETE RESTRICT,
        created_at timestamptz NOT NULL DEFAULT now(),
        PRIMARY KEY (project_id, user_id)
      );
      CREATE TABLE IF NOT EXISTS mlbox_sandboxes (
        id text PRIMARY KEY,
        project_id text NOT NULL UNIQUE REFERENCES mlbox_projects(id) ON DELETE RESTRICT,
        owner_user_id text NOT NULL REFERENCES mlbox_users(id) ON DELETE RESTRICT,
        hub_username text NOT NULL,
        server_name text NOT NULL,
        profile text,
        state text NOT NULL DEFAULT 'unknown',
        created_at timestamptz NOT NULL DEFAULT now()
      );
      CREATE TABLE IF NOT EXISTS mlbox_space_subscriptions (
        space_id text PRIMARY KEY REFERENCES mlbox_spaces(id) ON DELETE CASCADE,
        plan text NOT NULL,
        status text NOT NULL CHECK (status IN ('active', 'inactive')),
        provider text NOT NULL,
        started_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now()
      );
      CREATE TABLE IF NOT EXISTS mlbox_audit_events (
        id text PRIMARY KEY,
        space_id text NOT NULL REFERENCES mlbox_spaces(id) ON DELETE CASCADE,
        actor_user_id text NOT NULL REFERENCES mlbox_users(id) ON DELETE RESTRICT,
        action text NOT NULL,
        target text NOT NULL,
        metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
        created_at timestamptz NOT NULL DEFAULT now()
      );
      CREATE INDEX IF NOT EXISTS mlbox_space_memberships_user_idx ON mlbox_space_memberships(user_id, status);
      CREATE INDEX IF NOT EXISTS mlbox_projects_team_idx ON mlbox_projects(team_id);
      CREATE INDEX IF NOT EXISTS mlbox_project_access_user_idx ON mlbox_project_access(user_id);
    `);
  }

  async ensureUserBootstrap(userId: string, email: string): Promise<BootstrapContext> {
    const client = await this.pool.connect();
    const personalSpaceId = `personal:${userId}`;
    const defaultTeamId = `personal-team:${userId}`;
    try {
      await client.query("BEGIN");
      await client.query(
        `INSERT INTO mlbox_users (id, email) VALUES ($1, $2)
         ON CONFLICT (id) DO UPDATE SET email = EXCLUDED.email`,
        [userId, email],
      );
      await client.query(
        `INSERT INTO mlbox_spaces (id, type, name) VALUES ($1, 'personal', $2)
         ON CONFLICT (id) DO NOTHING`,
        [personalSpaceId, `${email}'s Space`],
      );
      await client.query(
        `INSERT INTO mlbox_space_memberships (space_id, user_id, role, status)
         VALUES ($1, $2, 'owner', 'active')
         ON CONFLICT (space_id, user_id) DO UPDATE SET role = 'owner', status = 'active'`,
        [personalSpaceId, userId],
      );
      await client.query(
        `INSERT INTO mlbox_teams (id, space_id, name) VALUES ($1, $2, 'Personal')
         ON CONFLICT (id) DO NOTHING`,
        [defaultTeamId, personalSpaceId],
      );
      await client.query(
        `INSERT INTO mlbox_team_members (team_id, user_id, role) VALUES ($1, $2, 'lead')
         ON CONFLICT (team_id, user_id) DO UPDATE SET role = 'lead'`,
        [defaultTeamId, userId],
      );
      await client.query("COMMIT");
      return { userId, email, personalSpaceId, defaultTeamId };
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async listProjects(userId: string, spaceId: string): Promise<ProjectRecord[]> {
    const result = await this.pool.query(
      `SELECT p.id, t.space_id, p.team_id, p.name, p.created_by
       FROM mlbox_projects p
       JOIN mlbox_teams t ON t.id = p.team_id
       JOIN mlbox_space_memberships sm ON sm.space_id = t.space_id AND sm.user_id = $1 AND sm.status = 'active'
       WHERE t.space_id = $2
       ORDER BY p.name`,
      [userId, spaceId],
    );
    return result.rows.map((row) => ({
      id: String(row.id),
      spaceId: String(row.space_id),
      teamId: String(row.team_id),
      name: String(row.name),
      createdBy: String(row.created_by),
    }));
  }

  async ensureSandboxProject(userId: string, email: string, sandboxName: string): Promise<ProjectRecord> {
    const result = await this.pool.query(
      `WITH personal_space AS (
         SELECT s.id AS space_id, t.id AS team_id
         FROM mlbox_spaces s JOIN mlbox_teams t ON t.space_id = s.id
         JOIN mlbox_space_memberships sm ON sm.space_id = s.id AND sm.user_id = $1 AND sm.status = 'active'
         WHERE s.id = $2 AND s.type = 'personal' AND t.id = $3
       ), project_row AS (
         INSERT INTO mlbox_projects (id, team_id, name, created_by)
         SELECT $4, team_id, $5, $1 FROM personal_space
         ON CONFLICT (team_id, name) DO UPDATE SET name = EXCLUDED.name
         RETURNING id, team_id, name, created_by
       )
       SELECT p.id, p.team_id, p.name, p.created_by, ps.space_id
       FROM project_row p CROSS JOIN personal_space ps`,
      [userId, `personal:${userId}`, `personal-team:${userId}`, randomUUID(), sandboxName],
    );
    const row = result.rows[0];
    if (!row) throw new Error("Personal project access denied");
    await this.pool.query(
      `INSERT INTO mlbox_sandboxes (id, project_id, owner_user_id, hub_username, server_name)
       SELECT $1, $2, $3, $4, $5
       WHERE NOT EXISTS (SELECT 1 FROM mlbox_sandboxes WHERE project_id = $2)`,
      [randomUUID(), row.id, userId, email, sandboxName],
    );
    return { id: String(row.id), spaceId: String(row.space_id), teamId: String(row.team_id), name: String(row.name), createdBy: String(row.created_by) };
  }

  async projectPermission(userId: string, projectId: string): Promise<ProjectPermission | null> {
    const result = await this.pool.query(
      `SELECT sm.role AS space_role, tm.role AS team_role, pa.role AS direct_role
       FROM mlbox_projects p
       JOIN mlbox_teams t ON t.id = p.team_id
       JOIN mlbox_space_memberships sm ON sm.space_id = t.space_id AND sm.user_id = $1 AND sm.status = 'active'
       LEFT JOIN mlbox_team_members tm ON tm.team_id = t.id AND tm.user_id = $1
       LEFT JOIN mlbox_project_access pa ON pa.project_id = p.id AND pa.user_id = $1
       WHERE p.id = $2`,
      [userId, projectId],
    );
    const row = result.rows[0];
    if (!row) return null;
    return resolveProjectPermission({
      spaceRole: row.space_role as Parameters<typeof resolveProjectPermission>[0]["spaceRole"],
      teamRole: row.team_role as Parameters<typeof resolveProjectPermission>[0]["teamRole"],
      directRole: row.direct_role as Parameters<typeof resolveProjectPermission>[0]["directRole"],
    });
  }

  async importSandboxMappings(userId: string, email: string, sandboxNames: string[]): Promise<void> {
    for (const sandboxName of sandboxNames) {
      await this.ensureSandboxProject(userId, email, sandboxName);
    }
  }

  async listAuthorizedSandboxNames(userId: string, action: "read" | "operate"): Promise<string[]> {
    const result = await this.pool.query(
      `SELECT sb.server_name
       FROM mlbox_sandboxes sb
       JOIN mlbox_projects p ON p.id = sb.project_id
       JOIN mlbox_teams t ON t.id = p.team_id
       JOIN mlbox_space_memberships sm ON sm.space_id = t.space_id AND sm.user_id = $1 AND sm.status = 'active'
       LEFT JOIN mlbox_team_members tm ON tm.team_id = t.id AND tm.user_id = $1
       LEFT JOIN mlbox_project_access pa ON pa.project_id = p.id AND pa.user_id = $1
       WHERE sb.owner_user_id = $1
         AND (CASE WHEN sm.role IN ('owner', 'admin') THEN true
                   WHEN sm.role = 'viewer' THEN $2 = 'read'
                   WHEN pa.role = 'blocked' THEN false
                   WHEN pa.role IS NOT NULL THEN $2 = 'read' OR pa.role IN ('manager', 'contributor')
                   ELSE tm.role IS NOT NULL AND ($2 = 'read' OR tm.role = 'lead')
              END)
       ORDER BY sb.server_name`,
      [userId, action],
    );
    return result.rows.map((row) => String(row.server_name));
  }

  async authorizeSandbox(userId: string, _email: string, sandboxName: string, action: "read" | "operate"): Promise<boolean> {
    const result = await this.pool.query(
      `SELECT sb.project_id
       FROM mlbox_sandboxes sb
       WHERE sb.owner_user_id = $1 AND sb.server_name = $2`,
      [userId, sandboxName],
    );
    const projectId = result.rows[0]?.project_id;
    if (!projectId) return false;
    const permission = await this.projectPermission(userId, String(projectId));
    if (!permission) return false;
    return action === "read" ? permission.canRead : permission.canOperate;
  }

  async activateMockSubscription(userId: string, spaceId: string, plan: string): Promise<SubscriptionRecord> {
    const result = await this.pool.query(
      `INSERT INTO mlbox_space_subscriptions (space_id, plan, status, provider)
       SELECT sm.space_id, $3, 'active', 'mock'
       FROM mlbox_space_memberships sm
       WHERE sm.user_id = $1 AND sm.space_id = $2 AND sm.status = 'active'
         AND sm.role IN ('owner', 'admin')
       ON CONFLICT (space_id) DO UPDATE SET plan = EXCLUDED.plan, status = 'active', provider = 'mock', updated_at = now()
       RETURNING space_id, plan, status, provider`,
      [userId, spaceId, plan],
    );
    const row = result.rows[0];
    if (!row) throw new Error("Subscription access denied");
    await this.pool.query(
      `INSERT INTO mlbox_audit_events (id, space_id, actor_user_id, action, target, metadata)
       VALUES ($1, $2, $3, 'subscription.mock_activated', $4, $5::jsonb)`,
      [randomUUID(), String(row.space_id), userId, String(row.plan), JSON.stringify({ provider: "mock" })],
    );
    return { spaceId: String(row.space_id), plan: String(row.plan), status: String(row.status), provider: String(row.provider) };
  }

  async createProject(userId: string, spaceId: string, teamId: string, name: string): Promise<ProjectRecord> {
    const result = await this.pool.query(
      `INSERT INTO mlbox_projects (id, team_id, name, created_by)
       SELECT $5, t.id, $4, $1
       FROM mlbox_teams t
       JOIN mlbox_space_memberships sm ON sm.space_id = t.space_id AND sm.user_id = $1 AND sm.status = 'active'
       WHERE t.id = $3 AND t.space_id = $2
       RETURNING id, team_id, name, created_by`,
      [userId, spaceId, teamId, name, randomUUID()],
    );
    const row = result.rows[0];
    if (!row) throw new Error("Project team access denied");
    return { id: String(row.id), spaceId, teamId: String(row.team_id), name: String(row.name), createdBy: String(row.created_by) };
  }

  async close(): Promise<void> {
    await this.pool.end();
  }
}
