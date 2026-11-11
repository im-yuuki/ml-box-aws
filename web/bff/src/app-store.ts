import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import type { ProfileInput } from "./account.js";
import { resolveProjectPermission, type ProjectPermission } from "./access.js";
import type { HubIdentity } from "./hub-identity.js";
import { buildHubIdentityMigrationReport, type HubIdentityMigrationReport } from "./hub-identity-migration.js";
import {
  entitlementsForPlan,
  getMockPlan,
  type MockPaymentMethod,
  type MockPaymentOutcome,
  type MockPlan,
  type SpaceType,
  type SubscriptionStatus,
} from "./mock-billing.js";

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

export const TEAM_MANAGEMENT_DENIED = "Team management denied";
export const SPACE_MEMBER_NOT_FOUND = "Space member not found";
export const LAST_TEAM_LEAD = "Team must keep at least one lead";

export type SpaceSummary = {
  id: string;
  type: "personal" | "organization";
  name: string;
  role: SpaceRole;
};

export type UsageSummary = {
  windowDays: number;
  sessions: number;
  hours: number;
  openSession: boolean;
};

export type SpaceUsageSummary = {
  spaceId: string;
  windowDays: number;
  totalHours: number;
  projects: Array<{ projectId: string; name: string; sessions: number; hours: number }>;
};

export const INVITATION_NOT_AVAILABLE = "Invitation is not available";
export type InvitationRole = "admin" | "member" | "viewer";

export type InvitationRecord = {
  id: string;
  spaceId: string;
  email: string;
  role: InvitationRole;
  status: "pending" | "accepted" | "revoked";
};

function invitationFromRow(row: Record<string, unknown>): InvitationRecord {
  return {
    id: String(row.id),
    spaceId: String(row.space_id),
    email: String(row.email),
    role: String(row.role) as InvitationRole,
    status: String(row.status) as InvitationRecord["status"],
  };
}

export type TeamRecord = {
  id: string;
  spaceId: string;
  name: string;
};

export type TeamMemberRecord = {
  userId: string;
  role: TeamRole;
  email: string | null;
};

export const PROJECT_RUNTIME_OWNER_NOT_READY = "Project runtime owner is not provisioned";

export type ProjectSandboxRuntime = {
  projectId: string;
  ownerUserId: string;
  hubUsername: string;
  serverName: string;
  state: string;
  profile: string | null;
};

function projectSandboxFromRow(row: Record<string, unknown>): ProjectSandboxRuntime {
  return {
    projectId: String(row.project_id),
    ownerUserId: String(row.owner_user_id),
    hubUsername: String(row.hub_username),
    serverName: String(row.server_name),
    state: String(row.state ?? "unknown"),
    profile: nullableText(row.profile),
  };
}

function nullableText(value: unknown): string | null {
  return value == null ? null : String(value);
}

export type AccountProfileRecord = {
  email: string;
  fullName: string | null;
  jobTitle: string | null;
  timezone: string | null;
  birthDate: string | null;
  gender: string | null;
  avatarDataUrl: string | null;
  preferredSandboxProfile: string | null;
};

export type AuthSessionRecord = {
  sessionId: string;
  userAgent: string;
  createdAt: string;
  lastSeenAt: string;
};

export type ArtifactRecord = {
  id: string;
  projectId: string;
  name: string;
  objectKey: string;
  contentType: string;
  sizeBytes: number;
  status: "pending" | "ready";
  createdBy: string;
};

function artifactFromRow(row: Record<string, unknown>): ArtifactRecord {
  return {
    id: String(row.id),
    projectId: String(row.project_id),
    name: String(row.name),
    objectKey: String(row.object_key),
    contentType: String(row.content_type),
    sizeBytes: Number(row.size_bytes),
    status: row.status === "ready" ? "ready" : "pending",
    createdBy: String(row.created_by),
  };
}

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
  status: SubscriptionStatus | string;
  provider: string;
  paymentId?: string | null;
  startedAt?: string | null;
  currentPeriodEnd?: string | null;
};

export type EntitlementRecord = {
  resource: string;
  limitValue: number | null;
  sourcePlan: string;
};

export type PaymentRecord = {
  id: string;
  spaceId: string;
  planId: string;
  subscriptionId: string | null;
  amountCents: number;
  currency: string;
  paymentMethod: MockPaymentMethod;
  status: MockPaymentOutcome;
  provider: string;
  failureCode: string | null;
  idempotencyKey: string;
  createdBy: string;
  createdAt?: string;
  updatedAt?: string;
};

export type SubscriptionDetails = {
  spaceId: string;
  spaceType: SpaceType;
  subscription: SubscriptionRecord | null;
  entitlements: EntitlementRecord[];
};

export type MockCheckoutInput = {
  spaceId: string;
  planId: string;
  amountCents: number;
  paymentMethod: MockPaymentMethod;
  outcome: MockPaymentOutcome;
  idempotencyKey: string;
};

export type MockCheckoutResult = {
  payment: PaymentRecord | null;
  subscription: SubscriptionRecord;
  entitlements: EntitlementRecord[];
};

function hubIdentityFromRow(row: Record<string, unknown>): HubIdentity {
  const userId = row.user_id ?? row.userId;
  const hubUsername = row.hub_username ?? row.hubUsername;
  const legacyEmail = row.legacy_email ?? row.legacyEmail;
  const previousHubUsername = row.previous_hub_username ?? row.previousHubUsername;
  return {
    userId: String(userId),
    hubUsername: String(hubUsername),
    legacyEmail: legacyEmail == null ? null : String(legacyEmail),
    previousHubUsername: previousHubUsername == null ? null : String(previousHubUsername),
    status: String(row.status) as HubIdentity["status"],
  };
}

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

  // Readiness probe: proves the app database answers, not just that the process has config.
  async ping(): Promise<void> {
    await this.pool.query("SELECT 1");
  }

  async recordAuditEvent(
    userId: string,
    spaceId: string,
    action: string,
    target: string,
    metadata: Record<string, unknown> = {},
  ): Promise<void> {
    await this.pool.query(
      `INSERT INTO mlbox_audit_events (id, space_id, actor_user_id, action, target, metadata) VALUES ($1, $2, $3, $4, $5, $6::jsonb)`,
      [randomUUID(), spaceId, userId, action, target, JSON.stringify(metadata)],
    );
  }

  async createHubHandoffCode(codeHash: string, hubUsername: string, nextPath: string, ttlSeconds: number): Promise<void> {
    await this.pool.query(
      `INSERT INTO mlbox_hub_handoff_codes (code_hash, hub_username, next_path, expires_at)
       VALUES ($1, $2, $3, now() + ($4 || ' seconds')::interval)`,
      [codeHash, hubUsername, nextPath, String(ttlSeconds)],
    );
  }

  // Single atomic statement: a code can be redeemed once, and only before it expires.
  async redeemHubHandoffCode(codeHash: string): Promise<{ hubUsername: string; nextPath: string } | null> {
    const result = await this.pool.query(
      `UPDATE mlbox_hub_handoff_codes SET used_at = now()
       WHERE code_hash = $1 AND used_at IS NULL AND expires_at > now()
       RETURNING hub_username, next_path`,
      [codeHash],
    );
    const row = result.rows[0];
    if (!row) return null;
    return { hubUsername: String(row.hub_username), nextPath: String(row.next_path) };
  }

  async getHubIdentity(userId: string): Promise<HubIdentity | null> {
    const result = await this.pool.query(
      `SELECT user_id, hub_username, legacy_email, previous_hub_username, status
       FROM mlbox_hub_identities WHERE user_id = $1`,
      [userId],
    );
    const row = result.rows[0];
    return row ? hubIdentityFromRow(row) : null;
  }

  async upsertHubIdentity(mapping: HubIdentity): Promise<void> {
    if (mapping.status === "conflict") throw new Error("Cannot persist conflicting Hub identity");
    await this.pool.query(
      `INSERT INTO mlbox_hub_identities
         (user_id, hub_username, legacy_email, status, previous_hub_username)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (user_id) DO UPDATE SET
         hub_username = EXCLUDED.hub_username,
         legacy_email = EXCLUDED.legacy_email,
         status = EXCLUDED.status,
         previous_hub_username = EXCLUDED.previous_hub_username,
         updated_at = now()`,
      [mapping.userId, mapping.hubUsername, mapping.legacyEmail, mapping.status, mapping.previousHubUsername],
    );
  }

  async listHubIdentityMappings(): Promise<HubIdentity[]> {
    const result = await this.pool.query(
      `SELECT user_id, hub_username, legacy_email, previous_hub_username, status
       FROM mlbox_hub_identities ORDER BY user_id`,
    );
    return result.rows.map(hubIdentityFromRow);
  }

  async planHubIdentityMigration(): Promise<HubIdentityMigrationReport> {
    return buildHubIdentityMigrationReport(await this.listHubIdentityMappings());
  }

  async findHubIdentityByLegacyEmail(email: string): Promise<HubIdentity | null> {
    const result = await this.pool.query(
      `SELECT user_id, hub_username, legacy_email, previous_hub_username, status
       FROM mlbox_hub_identities WHERE legacy_email = $1 ORDER BY updated_at DESC LIMIT 1`,
      [email],
    );
    const row = result.rows[0];
    return row ? hubIdentityFromRow(row) : null;
  }

  async findLegacyHubIdentityByUser(userId: string, email: string): Promise<HubIdentity | null> {
    const result = await this.pool.query(
      `SELECT owner_user_id AS user_id, hub_username, hub_username AS legacy_email, NULL AS previous_hub_username, 'legacy' AS status
       FROM mlbox_sandboxes
       WHERE owner_user_id = $1 AND hub_username = $2
       ORDER BY created_at ASC LIMIT 1`,
      [userId, email],
    );
    const row = result.rows[0];
    return row ? hubIdentityFromRow(row) : null;
  }

  async recordHubIdentityMigrationConflict(userId: string, reason: string): Promise<void> {
    await this.pool.query(
      `UPDATE mlbox_hub_identities SET status = 'conflict', updated_at = now() WHERE user_id = $1`,
      [userId],
    );
    await this.recordAuditEvent(userId, `personal:${userId}`, "hub.identity_migration_conflict", userId, { reason });
  }

  async ensureSchema(): Promise<void> {
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS mlbox_users (
        id text PRIMARY KEY,
        email text NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now()
      );
      ALTER TABLE mlbox_users ADD COLUMN IF NOT EXISTS birth_date date;
      ALTER TABLE mlbox_users ADD COLUMN IF NOT EXISTS gender text CHECK (gender IN ('female', 'male', 'other', 'prefer_not_to_say'));
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

      CREATE TABLE IF NOT EXISTS mlbox_artifacts (
        id text PRIMARY KEY,
        project_id text NOT NULL REFERENCES mlbox_projects(id) ON DELETE RESTRICT,
        name text NOT NULL,
        object_key text NOT NULL UNIQUE,
        content_type text NOT NULL,
        size_bytes bigint NOT NULL,
        status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'ready')),
        created_by text NOT NULL REFERENCES mlbox_users(id) ON DELETE RESTRICT,
        created_at timestamptz NOT NULL DEFAULT now()
      );
      ALTER TABLE mlbox_artifacts ADD COLUMN IF NOT EXISTS deleted_at timestamptz;
      CREATE INDEX IF NOT EXISTS mlbox_artifacts_project_idx ON mlbox_artifacts(project_id);

      CREATE TABLE IF NOT EXISTS mlbox_usage_sessions (
        id text PRIMARY KEY,
        space_id text NOT NULL REFERENCES mlbox_spaces(id) ON DELETE CASCADE,
        project_id text NOT NULL REFERENCES mlbox_projects(id) ON DELETE RESTRICT,
        started_by text NOT NULL REFERENCES mlbox_users(id) ON DELETE RESTRICT,
        started_at timestamptz NOT NULL DEFAULT now(),
        ended_at timestamptz,
        source text NOT NULL DEFAULT 'bff_lifecycle' CHECK (source IN ('bff_lifecycle'))
      );
      CREATE INDEX IF NOT EXISTS mlbox_usage_sessions_project_idx ON mlbox_usage_sessions(project_id, started_at);
      CREATE INDEX IF NOT EXISTS mlbox_usage_sessions_space_idx ON mlbox_usage_sessions(space_id, started_at);
      -- Compute units per runtime-hour captured at start. Rows from before this column count at the CPU rate.
      ALTER TABLE mlbox_usage_sessions ADD COLUMN IF NOT EXISTS units_per_hour numeric NOT NULL DEFAULT 1;
      CREATE INDEX IF NOT EXISTS mlbox_usage_sessions_open_idx ON mlbox_usage_sessions(space_id, started_at) WHERE ended_at IS NULL;

      CREATE TABLE IF NOT EXISTS mlbox_space_invitations (
        id text PRIMARY KEY,
        space_id text NOT NULL REFERENCES mlbox_spaces(id) ON DELETE CASCADE,
        email text NOT NULL,
        role text NOT NULL CHECK (role IN ('admin', 'member', 'viewer')),
        status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'revoked')),
        created_by text NOT NULL REFERENCES mlbox_users(id) ON DELETE RESTRICT,
        created_at timestamptz NOT NULL DEFAULT now(),
        accepted_by text REFERENCES mlbox_users(id) ON DELETE RESTRICT,
        accepted_at timestamptz
      );
      CREATE UNIQUE INDEX IF NOT EXISTS mlbox_space_invitations_pending_idx
        ON mlbox_space_invitations(space_id, lower(email)) WHERE status = 'pending';
      CREATE TABLE IF NOT EXISTS mlbox_hub_identities (
        user_id text PRIMARY KEY REFERENCES mlbox_users(id) ON DELETE CASCADE,
        hub_username text NOT NULL,
        legacy_email text,
        status text NOT NULL CHECK (status IN ('legacy', 'mapped', 'migrated', 'conflict')),
        previous_hub_username text,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        UNIQUE (hub_username)
      );
      CREATE UNIQUE INDEX IF NOT EXISTS mlbox_hub_identities_hub_username_idx ON mlbox_hub_identities(hub_username);
      ALTER TABLE mlbox_hub_identities ADD COLUMN IF NOT EXISTS previous_hub_username text;

      CREATE TABLE IF NOT EXISTS mlbox_hub_handoff_codes (
        code_hash text PRIMARY KEY,
        hub_username text NOT NULL,
        next_path text NOT NULL,
        expires_at timestamptz NOT NULL,
        used_at timestamptz,
        created_at timestamptz NOT NULL DEFAULT now()
      );
      CREATE INDEX IF NOT EXISTS mlbox_hub_handoff_codes_expires_idx ON mlbox_hub_handoff_codes(expires_at);

      CREATE TABLE IF NOT EXISTS mlbox_space_subscriptions (
        space_id text PRIMARY KEY REFERENCES mlbox_spaces(id) ON DELETE CASCADE,
        plan text NOT NULL,
        status text NOT NULL CHECK (status IN ('inactive', 'pending', 'active', 'past_due', 'cancelled')),
        provider text NOT NULL,
        payment_id text,
        started_at timestamptz NOT NULL DEFAULT now(),
        current_period_end timestamptz,
        updated_at timestamptz NOT NULL DEFAULT now()
      );
      ALTER TABLE mlbox_space_subscriptions ADD COLUMN IF NOT EXISTS payment_id text;
      ALTER TABLE mlbox_space_subscriptions ADD COLUMN IF NOT EXISTS current_period_end timestamptz;
      ALTER TABLE mlbox_space_subscriptions DROP CONSTRAINT IF EXISTS mlbox_space_subscriptions_status_check;
      ALTER TABLE mlbox_space_subscriptions ADD CONSTRAINT mlbox_space_subscriptions_status_check CHECK (status IN ('inactive', 'pending', 'active', 'past_due', 'cancelled'));
      CREATE TABLE IF NOT EXISTS mlbox_payment_transactions (
        id text PRIMARY KEY,
        space_id text NOT NULL REFERENCES mlbox_spaces(id) ON DELETE CASCADE,
        plan_id text NOT NULL,
        subscription_id text,
        amount_cents integer NOT NULL CHECK (amount_cents >= 0),
        currency text NOT NULL DEFAULT 'USD',
        payment_method text NOT NULL CHECK (payment_method IN ('mock_card', 'mock_bank_transfer', 'mock_invoice')),
        status text NOT NULL CHECK (status IN ('pending', 'succeeded', 'failed', 'cancelled')),
        provider text NOT NULL DEFAULT 'mock',
        failure_code text,
        idempotency_key text NOT NULL,
        created_by text NOT NULL REFERENCES mlbox_users(id) ON DELETE RESTRICT,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        UNIQUE (space_id, idempotency_key)
      );
      CREATE TABLE IF NOT EXISTS mlbox_space_entitlements (
        space_id text NOT NULL REFERENCES mlbox_spaces(id) ON DELETE CASCADE,
        resource text NOT NULL,
        limit_value numeric,
        source_plan text NOT NULL,
        updated_at timestamptz NOT NULL DEFAULT now(),
        PRIMARY KEY (space_id, resource)
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
      ALTER TABLE mlbox_users ADD COLUMN IF NOT EXISTS full_name text;
      ALTER TABLE mlbox_users ADD COLUMN IF NOT EXISTS job_title text;
      ALTER TABLE mlbox_users ADD COLUMN IF NOT EXISTS timezone text;
      ALTER TABLE mlbox_users ADD COLUMN IF NOT EXISTS avatar_data_url text;
      ALTER TABLE mlbox_users ADD COLUMN IF NOT EXISTS preferred_sandbox_profile text;
      ALTER TABLE mlbox_projects ADD COLUMN IF NOT EXISTS artifacts_enabled boolean NOT NULL DEFAULT false;
      ALTER TABLE mlbox_projects ADD COLUMN IF NOT EXISTS deleted_at timestamptz;
      CREATE TABLE IF NOT EXISTS mlbox_auth_sessions (
        session_id text PRIMARY KEY,
        user_id text NOT NULL REFERENCES mlbox_users(id) ON DELETE CASCADE,
        user_agent text NOT NULL DEFAULT '',
        created_at timestamptz NOT NULL DEFAULT now(),
        last_seen_at timestamptz NOT NULL DEFAULT now(),
        revoked_at timestamptz
      );
      CREATE INDEX IF NOT EXISTS mlbox_auth_sessions_user_idx ON mlbox_auth_sessions(user_id);
      CREATE INDEX IF NOT EXISTS mlbox_space_memberships_user_idx ON mlbox_space_memberships(user_id, status);
      CREATE INDEX IF NOT EXISTS mlbox_project_access_user_idx ON mlbox_project_access(user_id);
      CREATE INDEX IF NOT EXISTS mlbox_payment_transactions_space_idx ON mlbox_payment_transactions(space_id, created_at DESC);
    `);
    // Must run after the CREATE TABLE block: a pre-team_id mlbox_projects table is kept as-is by
    // CREATE TABLE IF NOT EXISTS, so team_id only exists once the legacy migration has run.
    await this.migrateLegacyProjects();
    await this.pool.query(`
      CREATE INDEX IF NOT EXISTS mlbox_projects_team_idx ON mlbox_projects(team_id);
      CREATE UNIQUE INDEX IF NOT EXISTS mlbox_projects_team_name_key ON mlbox_projects(team_id, name);
    `);
    // Backfill: a Space membership used to be enough to see the Space, but the Projects of a Team
    // are only visible to its Team members. Members who joined before that was fixed have no Team
    // row and saw an empty Space. The insert is idempotent, so it is safe to run on every start.
    // A viewer is left out on purpose: it stays read-only.
    await this.pool.query(`
      INSERT INTO mlbox_team_members (team_id, user_id, role)
      SELECT t.id, sm.user_id, 'member'
      FROM mlbox_space_memberships sm
      JOIN mlbox_teams t ON t.space_id = sm.space_id
      WHERE sm.status = 'active' AND sm.role IN ('admin', 'member')
      ON CONFLICT (team_id, user_id) DO NOTHING
    `);
  }

  // Projects used to belong to a Space (mlbox_projects.space_id). They now belong to a Team.
  // Each legacy Space gets one Team (the owner's personal team for personal Spaces) and its
  // Projects are moved there. The whole step is one transaction and is skipped once team_id exists.
  private async migrateLegacyProjects(): Promise<void> {
    await this.pool.query(`
      DO $$
      BEGIN
        IF EXISTS (SELECT 1 FROM information_schema.columns
                   WHERE table_schema = current_schema() AND table_name = 'mlbox_projects' AND column_name = 'space_id')
           AND NOT EXISTS (SELECT 1 FROM information_schema.columns
                   WHERE table_schema = current_schema() AND table_name = 'mlbox_projects' AND column_name = 'team_id') THEN
          INSERT INTO mlbox_teams (id, space_id, name)
          SELECT CASE WHEN s.type = 'personal' AND o.user_id IS NOT NULL THEN 'personal-team:' || o.user_id
                      ELSE 'team:' || s.id END,
                 s.id,
                 CASE WHEN s.type = 'personal' THEN 'Personal' ELSE 'Default' END
          FROM (SELECT DISTINCT space_id FROM mlbox_projects) ps
          JOIN mlbox_spaces s ON s.id = ps.space_id
          LEFT JOIN LATERAL (
            SELECT sm.user_id FROM mlbox_space_memberships sm
            WHERE sm.space_id = s.id AND sm.role = 'owner' AND sm.status = 'active'
            ORDER BY sm.user_id LIMIT 1
          ) o ON true
          ON CONFLICT DO NOTHING;

          -- Keep access: active Space owners lead the team, Space members keep working on its Projects.
          INSERT INTO mlbox_team_members (team_id, user_id, role)
          SELECT t.id, sm.user_id, CASE WHEN sm.role = 'owner' THEN 'lead' ELSE 'member' END
          FROM mlbox_teams t
          JOIN mlbox_space_memberships sm ON sm.space_id = t.space_id AND sm.status = 'active'
          WHERE (t.id LIKE 'personal-team:%' OR t.id LIKE 'team:%') AND sm.role IN ('owner', 'member')
          ON CONFLICT DO NOTHING;

          ALTER TABLE mlbox_projects ADD COLUMN team_id text;
          UPDATE mlbox_projects p SET team_id = (
            SELECT t.id FROM mlbox_teams t WHERE t.space_id = p.space_id ORDER BY t.created_at, t.id LIMIT 1
          );
          ALTER TABLE mlbox_projects ALTER COLUMN team_id SET NOT NULL;
          ALTER TABLE mlbox_projects ADD CONSTRAINT mlbox_projects_team_id_fkey
            FOREIGN KEY (team_id) REFERENCES mlbox_teams(id) ON DELETE RESTRICT;
          -- space_id is no longer written. Keep the column for data safety but stop requiring it.
          ALTER TABLE mlbox_projects DROP CONSTRAINT IF EXISTS mlbox_projects_space_id_name_key;
          ALTER TABLE mlbox_projects ALTER COLUMN space_id DROP NOT NULL;
        END IF;
      END $$;
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
    // Visible = space owner/admin/viewer, or a team member / direct grant that is not blocked.
    const result = await this.pool.query(
      `SELECT p.id, t.space_id, p.team_id, p.name, p.created_by
       FROM mlbox_projects p
       JOIN mlbox_teams t ON t.id = p.team_id
       JOIN mlbox_space_memberships sm ON sm.space_id = t.space_id AND sm.user_id = $1 AND sm.status = 'active'
       LEFT JOIN mlbox_team_members tm ON tm.team_id = t.id AND tm.user_id = $1
       LEFT JOIN mlbox_project_access pa ON pa.project_id = p.id AND pa.user_id = $1
       WHERE t.space_id = $2
         AND p.deleted_at IS NULL
         AND (
           sm.role IN ('owner', 'admin', 'viewer')
           OR (COALESCE(pa.role, '') <> 'blocked' AND (tm.user_id IS NOT NULL OR pa.role IS NOT NULL))
         )
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

  async ensureSandboxProject(userId: string, email: string, sandboxName: string, hubUsername = email): Promise<ProjectRecord> {
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
      [randomUUID(), row.id, userId, hubUsername, sandboxName],
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
       WHERE p.id = $2 AND p.deleted_at IS NULL`,
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

  async importSandboxMappings(userId: string, email: string, sandboxNames: string[], hubUsername = email): Promise<void> {
    for (const sandboxName of sandboxNames) {
      await this.ensureSandboxProject(userId, email, sandboxName, hubUsername);
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

  async getSpaceType(userId: string, spaceId: string): Promise<SpaceType | null> {
    const result = await this.pool.query(
      `SELECT s.type
       FROM mlbox_spaces s
       JOIN mlbox_space_memberships sm ON sm.space_id = s.id
       WHERE s.id = $2 AND sm.user_id = $1 AND sm.status = 'active'`,
      [userId, spaceId],
    );
    const type = result.rows[0]?.type;
    return type === "personal" || type === "organization" ? type : null;
  }

  async getSubscriptionDetails(userId: string, spaceId: string): Promise<SubscriptionDetails | null> {
    const space = await this.pool.query(
      `SELECT s.id, s.type
       FROM mlbox_spaces s
       JOIN mlbox_space_memberships sm ON sm.space_id = s.id AND sm.user_id = $1 AND sm.status = 'active'
       WHERE s.id = $2`,
      [userId, spaceId],
    );
    const spaceRow = space.rows[0];
    if (!spaceRow || !["personal", "organization"].includes(String(spaceRow.type))) return null;
    const subscriptionResult = await this.pool.query(
      `SELECT space_id, plan, status, provider, payment_id, started_at, current_period_end
       FROM mlbox_space_subscriptions WHERE space_id = $1`,
      [spaceId],
    );
    const entitlementResult = await this.pool.query(
      `SELECT resource, limit_value, source_plan FROM mlbox_space_entitlements WHERE space_id = $1 ORDER BY resource`,
      [spaceId],
    );
    const row = subscriptionResult.rows[0];
    return {
      spaceId,
      spaceType: String(spaceRow.type) as SpaceType,
      subscription: row ? this.subscriptionRecord(row) : null,
      entitlements: entitlementResult.rows.map((entitlement) => ({ resource: String(entitlement.resource), limitValue: entitlement.limit_value == null ? null : Number(entitlement.limit_value), sourcePlan: String(entitlement.source_plan) })),
    };
  }

  async listPayments(userId: string, spaceId: string): Promise<PaymentRecord[]> {
    const result = await this.pool.query(
      `SELECT p.id, p.space_id, p.plan_id, p.subscription_id, p.amount_cents, p.currency, p.payment_method, p.status, p.provider, p.failure_code, p.idempotency_key, p.created_by, p.created_at, p.updated_at
       FROM mlbox_payment_transactions p
       JOIN mlbox_space_memberships sm ON sm.space_id = p.space_id AND sm.user_id = $1 AND sm.status = 'active'
       WHERE p.space_id = $2 ORDER BY p.created_at DESC`,
      [userId, spaceId],
    );
    return result.rows.map((row) => this.paymentRecord(row));
  }

  async activateFreeSubscription(userId: string, spaceId: string, plan: MockPlan): Promise<MockCheckoutResult> {
    const details = await this.getSubscriptionDetails(userId, spaceId);
    if (!details || details.spaceType !== plan.spaceType) throw new Error("Subscription access denied");
    const result = await this.pool.query(
      `INSERT INTO mlbox_space_subscriptions (space_id, plan, status, provider, payment_id, started_at, current_period_end)
       SELECT sm.space_id, $3, 'active', 'mock', NULL, now(), now() + interval '1 month'
       FROM mlbox_space_memberships sm
       WHERE sm.user_id = $1 AND sm.space_id = $2 AND sm.status = 'active' AND sm.role IN ('owner', 'admin')
       ON CONFLICT (space_id) DO UPDATE SET plan = EXCLUDED.plan, status = 'active', provider = 'mock', payment_id = NULL, current_period_end = EXCLUDED.current_period_end, updated_at = now()
       RETURNING space_id, plan, status, provider, payment_id, started_at, current_period_end`,
      [userId, spaceId, plan.id],
    );
    const row = result.rows[0];
    if (!row) throw new Error("Subscription access denied");
    for (const [resource, limit] of Object.entries(entitlementsForPlan(plan))) {
      await this.pool.query(
        `INSERT INTO mlbox_space_entitlements (space_id, resource, limit_value, source_plan) VALUES ($1, $2, $3, $4)
         ON CONFLICT (space_id, resource) DO UPDATE SET limit_value = EXCLUDED.limit_value, source_plan = EXCLUDED.source_plan, updated_at = now()`,
        [spaceId, resource, limit, plan.id],
      );
    }
    await this.pool.query(
      `INSERT INTO mlbox_audit_events (id, space_id, actor_user_id, action, target, metadata) VALUES ($1, $2, $3, 'subscription.mock_activated', $4, $5::jsonb)`,
      [randomUUID(), spaceId, userId, plan.id, JSON.stringify({ provider: "mock", free: true })],
    );
    return { payment: null, subscription: this.subscriptionRecord(row), entitlements: Object.entries(entitlementsForPlan(plan)).map(([resource, limitValue]) => ({ resource, limitValue, sourcePlan: plan.id })) };
  }

  async retryMockPayment(userId: string, paymentId: string, input: Omit<MockCheckoutInput, "spaceId" | "planId" | "amountCents">): Promise<MockCheckoutResult> {
    const current = await this.pool.query(
      `SELECT p.id, p.space_id, p.plan_id, p.amount_cents, p.status
       FROM mlbox_payment_transactions p JOIN mlbox_space_memberships sm ON sm.space_id = p.space_id AND sm.user_id = $1 AND sm.status = 'active'
       WHERE p.id = $2 AND sm.role IN ('owner', 'admin')`,
      [userId, paymentId],
    );
    const row = current.rows[0];
    if (!row) throw new Error("Subscription access denied");
    if (!["failed", "past_due"].includes(String(row.status))) throw new Error("Payment cannot be retried");
    await this.pool.query(
      `INSERT INTO mlbox_audit_events (id, space_id, actor_user_id, action, target, metadata) VALUES ($1, $2, $3, 'payment.mock_retried', $4, $5::jsonb)`,
      [randomUUID(), String(row.space_id), userId, paymentId, JSON.stringify({ provider: "mock" })],
    );
    return this.createMockCheckout(userId, { spaceId: String(row.space_id), planId: String(row.plan_id), amountCents: Number(row.amount_cents), ...input });
  }

  async cancelMockSubscription(userId: string, spaceId: string): Promise<SubscriptionRecord> {
    const result = await this.pool.query(
      `UPDATE mlbox_space_subscriptions s SET status = 'cancelled', updated_at = now()
       FROM mlbox_space_memberships sm WHERE s.space_id = $2 AND sm.space_id = s.space_id AND sm.user_id = $1 AND sm.status = 'active' AND sm.role IN ('owner', 'admin')
       RETURNING s.space_id, s.plan, s.status, s.provider, s.payment_id, s.started_at, s.current_period_end`,
      [userId, spaceId],
    );
    const row = result.rows[0];
    if (!row) throw new Error("Subscription access denied");
    await this.pool.query(
      `INSERT INTO mlbox_audit_events (id, space_id, actor_user_id, action, target, metadata) VALUES ($1, $2, $3, 'subscription.mock_cancelled', $4, $5::jsonb)`,
      [randomUUID(), spaceId, userId, String(row.plan), JSON.stringify({ provider: "mock" })],
    );
    return this.subscriptionRecord(row);
  }

  async createMockCheckout(userId: string, input: MockCheckoutInput): Promise<MockCheckoutResult> {
    const plan = getMockPlan(input.planId);
    if (!plan || plan.status !== "active") throw new Error("Invalid subscription plan");
    if (input.amountCents !== plan.amountCents) throw new Error("Invalid subscription amount");
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const access = await client.query(
        `SELECT s.id, s.type, sm.role
         FROM mlbox_spaces s JOIN mlbox_space_memberships sm ON sm.space_id = s.id
         WHERE s.id = $2 AND sm.user_id = $1 AND sm.status = 'active'`,
        [userId, input.spaceId],
      );
      const accessRow = access.rows[0];
      if (!accessRow || !["owner", "admin"].includes(String(accessRow.role))) throw new Error("Subscription access denied");
      if (String(accessRow.type) !== plan.spaceType) throw new Error("Space type mismatch");
      const existing = await client.query(
        `SELECT id, space_id, plan_id, subscription_id, amount_cents, currency, payment_method, status, provider, failure_code, idempotency_key, created_by, created_at, updated_at
         FROM mlbox_payment_transactions WHERE space_id = $1 AND idempotency_key = $2`,
        [input.spaceId, input.idempotencyKey],
      );
      if (existing.rows[0]) {
        const payment = this.paymentRecord(existing.rows[0]);
        await client.query("COMMIT");
        const details = await this.getSubscriptionDetails(userId, input.spaceId);
        if (!details?.subscription) throw new Error("Subscription state unavailable");
        return { payment, subscription: details.subscription, entitlements: details.entitlements };
      }
      const paymentId = randomUUID();
      await client.query(
        `INSERT INTO mlbox_audit_events (id, space_id, actor_user_id, action, target, metadata) VALUES ($1, $2, $3, 'subscription.mock_checkout_started', $4, $5::jsonb)`,
        [randomUUID(), input.spaceId, userId, input.planId, JSON.stringify({ provider: "mock", paymentMethod: input.paymentMethod })],
      );
      const paymentResult = await client.query(
        `INSERT INTO mlbox_payment_transactions (id, space_id, plan_id, subscription_id, amount_cents, currency, payment_method, status, provider, failure_code, idempotency_key, created_by)
         VALUES ($1, $2, $3, $2, $4, 'USD', $5, $6, 'mock', $7, $8, $9)
         RETURNING id, space_id, plan_id, subscription_id, amount_cents, currency, payment_method, status, provider, failure_code, idempotency_key, created_by, created_at, updated_at`,
        [paymentId, input.spaceId, input.planId, plan.amountCents, input.paymentMethod, input.outcome, input.outcome === "failed" ? "mock_failure" : null, input.idempotencyKey, userId],
      );
      const payment = this.paymentRecord(paymentResult.rows[0]);
      await client.query(
        `INSERT INTO mlbox_space_subscriptions (space_id, plan, status, provider, payment_id, started_at, current_period_end)
         VALUES ($1, $2, $3, 'mock', $4, now(), now() + interval '1 month')
         ON CONFLICT (space_id) DO UPDATE SET plan = EXCLUDED.plan, status = EXCLUDED.status, provider = 'mock', payment_id = EXCLUDED.payment_id, current_period_end = EXCLUDED.current_period_end, updated_at = now()`,
        [input.spaceId, input.planId, input.outcome === "succeeded" ? "active" : input.outcome === "pending" ? "pending" : input.outcome === "failed" ? "past_due" : "cancelled", paymentId],
      );
      const planEntitlements = entitlementsForPlan(plan);
      if (input.outcome === "succeeded") {
        for (const [resource, limit] of Object.entries(planEntitlements)) {
          await client.query(
            `INSERT INTO mlbox_space_entitlements (space_id, resource, limit_value, source_plan) VALUES ($1, $2, $3, $4)
             ON CONFLICT (space_id, resource) DO UPDATE SET limit_value = EXCLUDED.limit_value, source_plan = EXCLUDED.source_plan, updated_at = now()`,
            [input.spaceId, resource, limit, input.planId],
          );
        }
      }
      const action = input.outcome === "succeeded" ? "payment.mock_succeeded" : input.outcome === "pending" ? "payment.mock_pending" : input.outcome === "failed" ? "payment.mock_failed" : "payment.mock_cancelled";
      await client.query(
        `INSERT INTO mlbox_audit_events (id, space_id, actor_user_id, action, target, metadata) VALUES ($1, $2, $3, $4, $5, $6::jsonb)`,
        [randomUUID(), input.spaceId, userId, action, paymentId, JSON.stringify({ planId: input.planId, provider: "mock" })],
      );
      if (input.outcome === "succeeded") {
        await client.query(
          `INSERT INTO mlbox_audit_events (id, space_id, actor_user_id, action, target, metadata) VALUES ($1, $2, $3, 'subscription.mock_activated', $4, $5::jsonb)`,
          [randomUUID(), input.spaceId, userId, input.planId, JSON.stringify({ provider: "mock" })],
        );
      }
      await client.query("COMMIT");
      const details = await this.getSubscriptionDetails(userId, input.spaceId);
      if (!details?.subscription) throw new Error("Subscription state unavailable");
      return { payment, subscription: details.subscription, entitlements: details.entitlements };
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  private subscriptionRecord(row: Record<string, unknown>): SubscriptionRecord {
    return {
      spaceId: String(row.space_id), plan: String(row.plan), status: String(row.status), provider: String(row.provider),
      paymentId: row.payment_id == null ? null : String(row.payment_id),
      startedAt: row.started_at == null ? null : String(row.started_at),
      currentPeriodEnd: row.current_period_end == null ? null : String(row.current_period_end),
    };
  }

  private paymentRecord(row: Record<string, unknown>): PaymentRecord {
    return {
      id: String(row.id), spaceId: String(row.space_id), planId: String(row.plan_id), subscriptionId: row.subscription_id == null ? null : String(row.subscription_id),
      amountCents: Number(row.amount_cents), currency: String(row.currency), paymentMethod: String(row.payment_method) as MockPaymentMethod,
      status: String(row.status) as MockPaymentOutcome, provider: String(row.provider), failureCode: row.failure_code == null ? null : String(row.failure_code),
      idempotencyKey: String(row.idempotency_key), createdBy: String(row.created_by), createdAt: row.created_at == null ? undefined : String(row.created_at), updatedAt: row.updated_at == null ? undefined : String(row.updated_at),
    };
  }

  async activateMockSubscription(userId: string, spaceId: string, plan: string): Promise<SubscriptionRecord> {
    const catalogPlan = getMockPlan(plan);
    if (!catalogPlan || catalogPlan.status !== "active") throw new Error("Invalid subscription plan");
    if (catalogPlan.id === "personal_free") {
      const result = await this.activateFreeSubscription(userId, spaceId, catalogPlan);
      return result.subscription;
    }
    throw new Error("Mock checkout required");
  }

  async createProject(userId: string, spaceId: string, teamId: string, name: string): Promise<ProjectRecord> {
    const result = await this.pool.query(
      `INSERT INTO mlbox_projects (id, team_id, name, created_by)
       SELECT $5, t.id, $4, $1
       FROM mlbox_teams t
       JOIN mlbox_space_memberships sm ON sm.space_id = t.space_id AND sm.user_id = $1 AND sm.status = 'active'
       WHERE t.id = $3 AND t.space_id = $2
         AND (
           sm.role IN ('owner', 'admin')
           OR (sm.role = 'member' AND EXISTS (
             SELECT 1 FROM mlbox_team_members tm WHERE tm.team_id = t.id AND tm.user_id = $1
           ))
         )
       RETURNING id, team_id, name, created_by`,
      [userId, spaceId, teamId, name, randomUUID()],
    );
    const row = result.rows[0];
    if (!row) throw new Error("Project team access denied");
    return { id: String(row.id), spaceId, teamId: String(row.team_id), name: String(row.name), createdBy: String(row.created_by) };
  }

  // Artifacts are metadata only here; bytes live in S3 under the Project's prefix.
  async getProjectSpaceId(projectId: string): Promise<string | null> {
    const result = await this.pool.query(
      `SELECT t.space_id FROM mlbox_projects p JOIN mlbox_teams t ON t.id = p.team_id WHERE p.id = $1 AND p.deleted_at IS NULL`,
      [projectId],
    );
    const value = result.rows[0]?.space_id;
    return value === undefined || value === null ? null : String(value);
  }

  async listArtifacts(projectId: string): Promise<ArtifactRecord[]> {
    const result = await this.pool.query(
      `SELECT id, project_id, name, object_key, content_type, size_bytes, status, created_by
       FROM mlbox_artifacts WHERE project_id = $1 AND deleted_at IS NULL ORDER BY created_at DESC`,
      [projectId],
    );
    return result.rows.map(artifactFromRow);
  }

  async getArtifact(projectId: string, artifactId: string): Promise<ArtifactRecord | null> {
    const result = await this.pool.query(
      `SELECT id, project_id, name, object_key, content_type, size_bytes, status, created_by
       FROM mlbox_artifacts WHERE project_id = $1 AND id = $2 AND deleted_at IS NULL`,
      [projectId, artifactId],
    );
    const row = result.rows[0];
    return row ? artifactFromRow(row) : null;
  }

  async createArtifact(input: {
    id: string;
    projectId: string;
    name: string;
    objectKey: string;
    contentType: string;
    sizeBytes: number;
    createdBy: string;
  }): Promise<ArtifactRecord> {
    const result = await this.pool.query(
      `INSERT INTO mlbox_artifacts (id, project_id, name, object_key, content_type, size_bytes, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING id, project_id, name, object_key, content_type, size_bytes, status, created_by`,
      [input.id, input.projectId, input.name, input.objectKey, input.contentType, input.sizeBytes, input.createdBy],
    );
    return artifactFromRow(result.rows[0] ?? {});
  }

  async markArtifactReady(projectId: string, artifactId: string): Promise<boolean> {
    const result = await this.pool.query(
      `UPDATE mlbox_artifacts SET status = 'ready' WHERE project_id = $1 AND id = $2 AND status = 'pending' RETURNING id`,
      [projectId, artifactId],
    );
    return result.rows.length > 0;
  }

  // Project-scoped runtime (phase 4, option A): the Hub server always runs under the Project
  // owner's Hub user. Authorization is decided per Project; the owner is only the runtime holder.
  async getProjectSandboxRuntime(projectId: string): Promise<ProjectSandboxRuntime | null> {
    const result = await this.pool.query(
      `SELECT project_id, owner_user_id, hub_username, server_name, state, profile
       FROM mlbox_sandboxes WHERE project_id = $1`,
      [projectId],
    );
    const row = result.rows[0];
    return row ? projectSandboxFromRow(row) : null;
  }

  // Creates the runtime row on first start. Requires the owner to have a Hub identity, which is
  // persisted the first time the owner signs in to the dashboard.
  async ensureProjectSandboxRuntime(projectId: string): Promise<ProjectSandboxRuntime> {
    await this.pool.query(
      `INSERT INTO mlbox_sandboxes (id, project_id, owner_user_id, hub_username, server_name)
       SELECT $1, p.id, p.created_by, hi.hub_username, p.id
       FROM mlbox_projects p
       JOIN mlbox_hub_identities hi ON hi.user_id = p.created_by
       WHERE p.id = $2
       ON CONFLICT (project_id) DO NOTHING`,
      [randomUUID(), projectId],
    );
    const runtime = await this.getProjectSandboxRuntime(projectId);
    if (!runtime) throw new Error(PROJECT_RUNTIME_OWNER_NOT_READY);
    return runtime;
  }

  async listSpaces(userId: string): Promise<SpaceSummary[]> {
    const result = await this.pool.query(
      `SELECT s.id, s.type, s.name, sm.role
       FROM mlbox_spaces s
       JOIN mlbox_space_memberships sm ON sm.space_id = s.id AND sm.user_id = $1 AND sm.status = 'active'
       ORDER BY CASE WHEN s.type = 'personal' THEN 0 ELSE 1 END, s.name`,
      [userId],
    );
    return result.rows.map((row) => ({
      id: String(row.id),
      type: row.type === "organization" ? "organization" : "personal",
      name: String(row.name),
      role: String(row.role) as SpaceRole,
    }));
  }

  // Usage is measured from BFF-observed runtime transitions (start / stop / observed stopped).
  // It approximates quota display and is not billing data.
  async openUsageSession(projectId: string, actorId: string, unitsPerHour: number): Promise<void> {
    await this.pool.query(
      `INSERT INTO mlbox_usage_sessions (id, space_id, project_id, started_by, units_per_hour)
       SELECT $1, t.space_id, p.id, $3, $4
       FROM mlbox_projects p JOIN mlbox_teams t ON t.id = p.team_id
       WHERE p.id = $2
         AND NOT EXISTS (SELECT 1 FROM mlbox_usage_sessions u WHERE u.project_id = $2 AND u.ended_at IS NULL)`,
      [randomUUID(), projectId, actorId, unitsPerHour],
    );
  }

  // Space and its active plan for a Project. A Space with no active subscription is on the free tier (plan null).
  async spaceAndPlanForProject(projectId: string): Promise<{ spaceId: string; planId: string | null } | null> {
    const result = await this.pool.query(
      `SELECT t.space_id, s.plan
       FROM mlbox_projects p
       JOIN mlbox_teams t ON t.id = p.team_id
       LEFT JOIN mlbox_space_subscriptions s ON s.space_id = t.space_id AND s.status = 'active'
       WHERE p.id = $1`,
      [projectId],
    );
    const row = result.rows[0];
    if (!row) return null;
    return { spaceId: String(row.space_id), planId: row.plan == null ? null : String(row.plan) };
  }

  // Compute units consumed in the current calendar month (UTC) across all runtimes of the Space.
  // Open sessions count up to now, so a running runtime is charged as it runs.
  async creditsUsedThisMonth(spaceId: string): Promise<number> {
    const result = await this.pool.query(
      `SELECT COALESCE(sum(
         EXTRACT(EPOCH FROM (COALESCE(ended_at, now()) - GREATEST(started_at, date_trunc('month', now())))) / 3600.0 * units_per_hour
       ), 0) AS units
       FROM mlbox_usage_sessions
       WHERE space_id = $1 AND COALESCE(ended_at, now()) > date_trunc('month', now())`,
      [spaceId],
    );
    return Number(result.rows[0]?.units ?? 0);
  }

  // Closes this Space's open sessions older than maxHours at that bound. Used when a runtime stopped without a BFF stop event.
  async closeStaleUsageSessions(spaceId: string, maxHours: number): Promise<void> {
    await this.pool.query(
      `UPDATE mlbox_usage_sessions SET ended_at = started_at + make_interval(hours => $2::int)
       WHERE space_id = $1 AND ended_at IS NULL AND started_at < now() - make_interval(hours => $2::int)`,
      [spaceId, maxHours],
    );
  }

  async closeUsageSessions(projectId: string): Promise<void> {
    await this.pool.query(
      `UPDATE mlbox_usage_sessions SET ended_at = now() WHERE project_id = $1 AND ended_at IS NULL`,
      [projectId],
    );
  }

  async projectUsageSummary(projectId: string, windowDays: number): Promise<UsageSummary> {
    const result = await this.pool.query(
      `SELECT count(*) AS sessions,
              COALESCE(sum(EXTRACT(EPOCH FROM (COALESCE(ended_at, now()) - started_at))), 0) AS seconds,
              bool_or(ended_at IS NULL) AS open_session
       FROM mlbox_usage_sessions
       WHERE project_id = $1 AND started_at > now() - ($2::int * interval '1 day')`,
      [projectId, windowDays],
    );
    const row = result.rows[0] ?? {};
    return {
      windowDays,
      sessions: Number(row.sessions ?? 0),
      hours: Math.round((Number(row.seconds ?? 0) / 3600) * 100) / 100,
      openSession: Boolean(row.open_session),
    };
  }

  async spaceUsageSummary(userId: string, spaceId: string, windowDays: number): Promise<SpaceUsageSummary | null> {
    const membership = await this.pool.query(
      `SELECT 1 FROM mlbox_space_memberships WHERE space_id = $1 AND user_id = $2 AND status = 'active'`,
      [spaceId, userId],
    );
    if (!membership.rows[0]) return null;
    const result = await this.pool.query(
      `SELECT p.id AS project_id, p.name, count(u.id) AS sessions,
              COALESCE(sum(EXTRACT(EPOCH FROM (COALESCE(u.ended_at, now()) - u.started_at))), 0) AS seconds
       FROM mlbox_usage_sessions u
       JOIN mlbox_projects p ON p.id = u.project_id
       WHERE u.space_id = $1 AND u.started_at > now() - ($2::int * interval '1 day')
       GROUP BY p.id, p.name
       ORDER BY seconds DESC, p.name`,
      [spaceId, windowDays],
    );
    const projects = result.rows.map((row) => ({
      projectId: String(row.project_id),
      name: String(row.name),
      sessions: Number(row.sessions ?? 0),
      hours: Math.round((Number(row.seconds ?? 0) / 3600) * 100) / 100,
    }));
    const totalHours = Math.round(projects.reduce((sum, project) => sum + project.hours, 0) * 100) / 100;
    return { spaceId, windowDays, totalHours, projects };
  }

  // Invitations are recorded here; no email is sent. The invitee sees and accepts the invitation
  // after signing in with the same email address.
  async createSpaceInvitation(actorId: string, spaceId: string, email: string, role: InvitationRole): Promise<InvitationRecord> {
    const result = await this.pool.query(
      `INSERT INTO mlbox_space_invitations (id, space_id, email, role, created_by)
       SELECT $1, sm.space_id, lower($3), $4, $2
       FROM mlbox_space_memberships sm
       WHERE sm.space_id = $5 AND sm.user_id = $2 AND sm.status = 'active' AND sm.role IN ('owner', 'admin')
       ON CONFLICT (space_id, lower(email)) WHERE status = 'pending'
         DO UPDATE SET role = EXCLUDED.role
       RETURNING id, space_id, email, role, status`,
      [randomUUID(), actorId, email, role, spaceId],
    );
    const row = result.rows[0];
    if (!row) throw new Error(TEAM_MANAGEMENT_DENIED);
    return invitationFromRow(row);
  }

  async listSpaceInvitations(actorId: string, spaceId: string): Promise<InvitationRecord[]> {
    const result = await this.pool.query(
      `SELECT i.id, i.space_id, i.email, i.role, i.status
       FROM mlbox_space_invitations i
       JOIN mlbox_space_memberships sm ON sm.space_id = i.space_id AND sm.user_id = $1 AND sm.status = 'active' AND sm.role IN ('owner', 'admin')
       WHERE i.space_id = $2 AND i.status = 'pending'
       ORDER BY i.created_at DESC`,
      [actorId, spaceId],
    );
    return result.rows.map(invitationFromRow);
  }

  async revokeSpaceInvitation(actorId: string, spaceId: string, invitationId: string): Promise<void> {
    const result = await this.pool.query(
      `UPDATE mlbox_space_invitations i SET status = 'revoked'
       FROM mlbox_space_memberships sm
       WHERE i.id = $3 AND i.space_id = $2 AND i.status = 'pending'
         AND sm.space_id = i.space_id AND sm.user_id = $1 AND sm.status = 'active' AND sm.role IN ('owner', 'admin')
       RETURNING i.id`,
      [actorId, spaceId, invitationId],
    );
    if (!result.rows[0]) throw new Error(TEAM_MANAGEMENT_DENIED);
  }

  async listMyInvitations(email: string): Promise<InvitationRecord[]> {
    const result = await this.pool.query(
      `SELECT i.id, i.space_id, i.email, i.role, i.status
       FROM mlbox_space_invitations i
       WHERE lower(i.email) = lower($1) AND i.status = 'pending'
       ORDER BY i.created_at DESC`,
      [email],
    );
    return result.rows.map(invitationFromRow);
  }

  // Accepting adds the membership without downgrading an existing higher role.
  async acceptSpaceInvitation(userId: string, email: string, invitationId: string): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const invitation = await client.query(
        `UPDATE mlbox_space_invitations SET status = 'accepted', accepted_by = $1, accepted_at = now()
         WHERE id = $2 AND status = 'pending' AND lower(email) = lower($3)
         RETURNING space_id, role`,
        [userId, invitationId, email],
      );
      const row = invitation.rows[0];
      if (!row) throw new Error(INVITATION_NOT_AVAILABLE);
      await client.query(
        `INSERT INTO mlbox_space_memberships (space_id, user_id, role, status)
         VALUES ($1, $2, $3, 'active')
         ON CONFLICT (space_id, user_id) DO NOTHING`,
        [String(row.space_id), userId, String(row.role)],
      );
      // The Projects of a Team are only visible to its Team members, so joining the Space is not
      // enough: an admin or member also joins the Space's Teams. A viewer keeps read-only access
      // through the Space role alone and therefore gets no Team row.
      await client.query(
        `INSERT INTO mlbox_team_members (team_id, user_id, role)
         SELECT t.id, $2, 'member'
         FROM mlbox_teams t
         JOIN mlbox_space_memberships sm ON sm.space_id = t.space_id AND sm.user_id = $2 AND sm.status = 'active'
         WHERE t.space_id = $1 AND sm.role IN ('admin', 'member')
         ON CONFLICT (team_id, user_id) DO NOTHING`,
        [String(row.space_id), userId],
      );
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async listTeams(userId: string, spaceId: string): Promise<TeamRecord[]> {
    const result = await this.pool.query(
      `SELECT t.id, t.space_id, t.name
       FROM mlbox_teams t
       JOIN mlbox_space_memberships sm ON sm.space_id = t.space_id AND sm.user_id = $1 AND sm.status = 'active'
       WHERE t.space_id = $2
       ORDER BY t.name`,
      [userId, spaceId],
    );
    return result.rows.map((row) => ({ id: String(row.id), spaceId: String(row.space_id), name: String(row.name) }));
  }

  // Flat teams only: owners and admins of the Space manage teams and their members.
  async createTeam(userId: string, spaceId: string, name: string): Promise<TeamRecord> {
    const result = await this.pool.query(
      `INSERT INTO mlbox_teams (id, space_id, name)
       SELECT $3, sm.space_id, $4
       FROM mlbox_space_memberships sm
       WHERE sm.space_id = $2 AND sm.user_id = $1 AND sm.status = 'active' AND sm.role IN ('owner', 'admin')
       RETURNING id, space_id, name`,
      [userId, spaceId, randomUUID(), name],
    );
    const row = result.rows[0];
    if (!row) throw new Error(TEAM_MANAGEMENT_DENIED);
    return { id: String(row.id), spaceId: String(row.space_id), name: String(row.name) };
  }

  // ---- Organization (Space) management. Personal Spaces are never changed through these methods.

  async createOrganization(userId: string, name: string): Promise<{ spaceId: string; teamId: string }> {
    const spaceId = `org:${randomUUID()}`;
    const teamId = randomUUID();
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(`INSERT INTO mlbox_spaces (id, type, name) VALUES ($1, 'organization', $2)`, [spaceId, name]);
      await client.query(
        `INSERT INTO mlbox_space_memberships (space_id, user_id, role, status) VALUES ($1, $2, 'owner', 'active')`,
        [spaceId, userId],
      );
      // Projects always belong to a Team, so every organization starts with a default one.
      await client.query(`INSERT INTO mlbox_teams (id, space_id, name) VALUES ($1, $2, 'General')`, [teamId, spaceId]);
      await client.query(`INSERT INTO mlbox_team_members (team_id, user_id, role) VALUES ($1, $2, 'lead')`, [teamId, userId]);
      await client.query("COMMIT");
      return { spaceId, teamId };
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async activeSpaceRole(userId: string, spaceId: string): Promise<SpaceRole | null> {
    const result = await this.pool.query(
      `SELECT role FROM mlbox_space_memberships WHERE space_id = $1 AND user_id = $2 AND status = 'active'`,
      [spaceId, userId],
    );
    const row = result.rows[0];
    return row ? (String(row.role) as SpaceRole) : null;
  }

  // Seats a Space has taken: the active members plus the invitations waiting for an answer.
  // A plan with a member limit counts both, so an invitation cannot be used to pass the limit.
  async spaceMemberCount(spaceId: string): Promise<number> {
    const result = await this.pool.query(
      `SELECT
         (SELECT count(*) FROM mlbox_space_memberships WHERE space_id = $1 AND status = 'active')::int AS members,
         (SELECT count(*) FROM mlbox_space_invitations WHERE space_id = $1 AND status = 'pending')::int AS pending`,
      [spaceId],
    );
    const row = result.rows[0];
    return Number(row?.members ?? 0) + Number(row?.pending ?? 0);
  }

  async listSpaceMembers(spaceId: string): Promise<Array<{ userId: string; role: SpaceRole; email: string | null }>> {
    const result = await this.pool.query(
      `SELECT sm.user_id, sm.role, u.email
       FROM mlbox_space_memberships sm
       LEFT JOIN mlbox_users u ON u.id = sm.user_id
       WHERE sm.space_id = $1 AND sm.status = 'active'
       ORDER BY CASE sm.role WHEN 'owner' THEN 0 WHEN 'admin' THEN 1 WHEN 'member' THEN 2 ELSE 3 END, u.email`,
      [spaceId],
    );
    return result.rows.map((row) => ({
      userId: String(row.user_id),
      role: String(row.role) as SpaceRole,
      email: row.email === null || row.email === undefined ? null : String(row.email),
    }));
  }

  // The role of a member changes here. The owner row is never touched: ownership moves via transferSpaceOwnership.
  async setSpaceMemberRole(spaceId: string, targetUserId: string, role: SpaceRole): Promise<void> {
    const result = await this.pool.query(
      `UPDATE mlbox_space_memberships SET role = $3
       WHERE space_id = $1 AND user_id = $2 AND status = 'active' AND role <> 'owner'
       RETURNING user_id`,
      [spaceId, targetUserId, role],
    );
    if (!result.rows[0]) throw new Error(SPACE_MEMBER_NOT_FOUND);
  }

  // The owner becomes an admin and the target admin becomes the owner, in one transaction.
  async transferSpaceOwnership(spaceId: string, fromUserId: string, toUserId: string): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const demoted = await client.query(
        `UPDATE mlbox_space_memberships SET role = 'admin'
         WHERE space_id = $1 AND user_id = $2 AND status = 'active' AND role = 'owner'
         RETURNING user_id`,
        [spaceId, fromUserId],
      );
      if (!demoted.rows[0]) throw new Error(TEAM_MANAGEMENT_DENIED);
      const promoted = await client.query(
        `UPDATE mlbox_space_memberships SET role = 'owner'
         WHERE space_id = $1 AND user_id = $2 AND status = 'active' AND role = 'admin'
         RETURNING user_id`,
        [spaceId, toUserId],
      );
      if (!promoted.rows[0]) throw new Error(SPACE_MEMBER_NOT_FOUND);
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  // Removing a member also takes them out of every Team in the Space.
  async removeSpaceMember(spaceId: string, targetUserId: string): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const result = await client.query(
        `UPDATE mlbox_space_memberships SET status = 'revoked'
         WHERE space_id = $1 AND user_id = $2 AND status = 'active' AND role <> 'owner'
         RETURNING user_id`,
        [spaceId, targetUserId],
      );
      if (!result.rows[0]) throw new Error(SPACE_MEMBER_NOT_FOUND);
      await client.query(
        `DELETE FROM mlbox_team_members tm USING mlbox_teams t
         WHERE tm.team_id = t.id AND t.space_id = $1 AND tm.user_id = $2`,
        [spaceId, targetUserId],
      );
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async listProjectIdsInSpace(spaceId: string): Promise<string[]> {
    const result = await this.pool.query(
      `SELECT p.id FROM mlbox_projects p JOIN mlbox_teams t ON t.id = p.team_id
       WHERE t.space_id = $1 AND p.deleted_at IS NULL`,
      [spaceId],
    );
    return result.rows.map((row) => String(row.id));
  }

  // Ends the organization for everyone: its Projects are soft-deleted (like deleteProject), its
  // memberships and pending invitations are revoked, and its usage is closed. The rows stay for billing history.
  // The caller checks for running sandboxes and removes artifact objects and notebook claims first.
  async deleteOrganization(spaceId: string): Promise<void> {
    const client = await this.pool.connect();
    const projects = `SELECT p.id FROM mlbox_projects p JOIN mlbox_teams t ON t.id = p.team_id WHERE t.space_id = $1`;
    try {
      await client.query("BEGIN");
      await client.query(
        `UPDATE mlbox_usage_sessions SET ended_at = now() WHERE project_id IN (${projects}) AND ended_at IS NULL`,
        [spaceId],
      );
      await client.query(`UPDATE mlbox_artifacts SET deleted_at = now() WHERE project_id IN (${projects}) AND deleted_at IS NULL`, [spaceId]);
      await client.query(`DELETE FROM mlbox_sandboxes WHERE project_id IN (${projects})`, [spaceId]);
      await client.query(
        `UPDATE mlbox_projects SET deleted_at = now(), name = name || ' [deleted ' || id || ']'
         WHERE id IN (${projects}) AND deleted_at IS NULL`,
        [spaceId],
      );
      await client.query(
        `UPDATE mlbox_space_invitations SET status = 'revoked' WHERE space_id = $1 AND status = 'pending'`,
        [spaceId],
      );
      await client.query(
        `UPDATE mlbox_space_memberships SET status = 'revoked' WHERE space_id = $1 AND status = 'active'`,
        [spaceId],
      );
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  // Any active Space member can see who belongs to a team in their Space.
  async listTeamMembers(userId: string, spaceId: string, teamId: string): Promise<TeamMemberRecord[]> {
    const result = await this.pool.query(
      `SELECT tm.user_id, tm.role, u.email
       FROM mlbox_team_members tm
       JOIN mlbox_teams t ON t.id = tm.team_id
       JOIN mlbox_space_memberships sm ON sm.space_id = t.space_id AND sm.user_id = $1 AND sm.status = 'active'
       LEFT JOIN mlbox_users u ON u.id = tm.user_id
       WHERE t.id = $3 AND t.space_id = $2
       ORDER BY tm.role, u.email`,
      [userId, spaceId, teamId],
    );
    return result.rows.map((row) => ({
      userId: String(row.user_id),
      role: String(row.role) as TeamRole,
      email: row.email === null || row.email === undefined ? null : String(row.email),
    }));
  }

  async addTeamMember(actorId: string, spaceId: string, teamId: string, targetUserId: string, role: TeamRole): Promise<void> {
    const result = await this.pool.query(
      `INSERT INTO mlbox_team_members (team_id, user_id, role)
       SELECT t.id, $4, $5
       FROM mlbox_teams t
       JOIN mlbox_space_memberships actor ON actor.space_id = t.space_id AND actor.user_id = $1 AND actor.status = 'active' AND actor.role IN ('owner', 'admin')
       JOIN mlbox_space_memberships target ON target.space_id = t.space_id AND target.user_id = $4 AND target.status = 'active'
       WHERE t.id = $3 AND t.space_id = $2
       ON CONFLICT (team_id, user_id) DO UPDATE SET role = EXCLUDED.role
         WHERE mlbox_team_members.role <> 'lead' OR EXCLUDED.role = 'lead' OR EXISTS (
           SELECT 1 FROM mlbox_team_members o
           WHERE o.team_id = mlbox_team_members.team_id AND o.user_id <> mlbox_team_members.user_id AND o.role = 'lead'
         )
       RETURNING team_id`,
      [actorId, spaceId, teamId, targetUserId, role],
    );
    if (!result.rows[0]) {
      if (await this.isSoleLead(teamId, targetUserId)) throw new Error(LAST_TEAM_LEAD);
      throw new Error(TEAM_MANAGEMENT_DENIED);
    }
  }

  async removeTeamMember(actorId: string, spaceId: string, teamId: string, targetUserId: string): Promise<void> {
    const result = await this.pool.query(
      `DELETE FROM mlbox_team_members tm
       USING mlbox_teams t, mlbox_space_memberships actor
       WHERE tm.team_id = $3 AND tm.user_id = $4
         AND t.id = tm.team_id AND t.space_id = $2
         AND actor.space_id = $2 AND actor.user_id = $1 AND actor.status = 'active' AND actor.role IN ('owner', 'admin')
         AND (tm.role <> 'lead' OR EXISTS (
           SELECT 1 FROM mlbox_team_members o
           WHERE o.team_id = tm.team_id AND o.user_id <> tm.user_id AND o.role = 'lead'
         ))
       RETURNING tm.team_id`,
      [actorId, spaceId, teamId, targetUserId],
    );
    if (!result.rows[0]) {
      if (await this.isSoleLead(teamId, targetUserId)) throw new Error(LAST_TEAM_LEAD);
      throw new Error(TEAM_MANAGEMENT_DENIED);
    }
  }

  private async isSoleLead(teamId: string, userId: string): Promise<boolean> {
    const result = await this.pool.query(
      `SELECT
         EXISTS (SELECT 1 FROM mlbox_team_members WHERE team_id = $1 AND user_id = $2 AND role = 'lead') AS target_is_lead,
         (SELECT count(*) FROM mlbox_team_members WHERE team_id = $1 AND role = 'lead') AS lead_count`,
      [teamId, userId],
    );
    const row = result.rows[0];
    return Boolean(row?.target_is_lead) && Number(row?.lead_count) === 1;
  }

  // Account profile. Stored on the user row so every Space and page reads the same values.
  async getAccountProfile(userId: string): Promise<AccountProfileRecord | null> {
    const result = await this.pool.query(
      `SELECT email, full_name, job_title, timezone, avatar_data_url, preferred_sandbox_profile,
              to_char(birth_date, 'YYYY-MM-DD') AS birth_date, gender
       FROM mlbox_users WHERE id = $1`,
      [userId],
    );
    const row = result.rows[0];
    if (!row) return null;
    return {
      email: String(row.email),
      fullName: nullableText(row.full_name),
      jobTitle: nullableText(row.job_title),
      timezone: nullableText(row.timezone),
      birthDate: nullableText(row.birth_date),
      gender: nullableText(row.gender),
      avatarDataUrl: nullableText(row.avatar_data_url),
      preferredSandboxProfile: nullableText(row.preferred_sandbox_profile),
    };
  }

  async updateAccountProfile(userId: string, input: ProfileInput): Promise<void> {
    await this.pool.query(
      `UPDATE mlbox_users SET full_name = $2, job_title = $3, timezone = $4, birth_date = $5, gender = $6 WHERE id = $1`,
      [userId, input.fullName, input.jobTitle, input.timezone, input.birthDate, input.gender],
    );
  }

  async setAvatarDataUrl(userId: string, dataUrl: string | null): Promise<void> {
    await this.pool.query(`UPDATE mlbox_users SET avatar_data_url = $2 WHERE id = $1`, [userId, dataUrl]);
  }

  async setUserEmail(userId: string, email: string): Promise<void> {
    await this.pool.query(`UPDATE mlbox_users SET email = $2 WHERE id = $1`, [userId, email]);
  }

  // The last sandbox profile the user started. New starts default to it.
  async setPreferredSandboxProfile(userId: string, profile: string): Promise<void> {
    await this.pool.query(`UPDATE mlbox_users SET preferred_sandbox_profile = $2 WHERE id = $1`, [userId, profile]);
  }

  // Login sessions. A session id with no row is treated as active: sessions created before this
  // table existed cannot be listed or revoked, but they are not locked out either.
  async recordAuthSession(sessionId: string, userId: string, userAgent: string): Promise<void> {
    await this.pool.query(
      `INSERT INTO mlbox_auth_sessions (session_id, user_id, user_agent) VALUES ($1, $2, $3)
       ON CONFLICT (session_id) DO NOTHING`,
      [sessionId, userId, userAgent.slice(0, 255)],
    );
  }

  async touchAuthSession(sessionId: string): Promise<void> {
    await this.pool.query(
      `UPDATE mlbox_auth_sessions SET last_seen_at = now()
       WHERE session_id = $1 AND last_seen_at < now() - interval '5 minutes'`,
      [sessionId],
    );
  }

  async isAuthSessionActive(sessionId: string): Promise<boolean> {
    const result = await this.pool.query(`SELECT revoked_at FROM mlbox_auth_sessions WHERE session_id = $1`, [sessionId]);
    const row = result.rows[0];
    return !row || row.revoked_at == null;
  }

  async listAuthSessions(userId: string): Promise<AuthSessionRecord[]> {
    const result = await this.pool.query(
      `SELECT session_id, user_agent, created_at, last_seen_at FROM mlbox_auth_sessions
       WHERE user_id = $1 AND revoked_at IS NULL ORDER BY last_seen_at DESC`,
      [userId],
    );
    return result.rows.map((row) => ({
      sessionId: String(row.session_id),
      userAgent: String(row.user_agent),
      createdAt: new Date(String(row.created_at)).toISOString(),
      lastSeenAt: new Date(String(row.last_seen_at)).toISOString(),
    }));
  }

  async revokeAuthSession(userId: string, sessionId: string): Promise<boolean> {
    const result = await this.pool.query(
      `UPDATE mlbox_auth_sessions SET revoked_at = now()
       WHERE user_id = $1 AND session_id = $2 AND revoked_at IS NULL RETURNING session_id`,
      [userId, sessionId],
    );
    return result.rows.length > 0;
  }

  async revokeOtherAuthSessions(userId: string, currentSessionId: string): Promise<string[]> {
    const result = await this.pool.query(
      `UPDATE mlbox_auth_sessions SET revoked_at = now()
       WHERE user_id = $1 AND session_id <> $2 AND revoked_at IS NULL RETURNING session_id`,
      [userId, currentSessionId],
    );
    return result.rows.map((row) => String(row.session_id));
  }

  async getProjectArtifactsEnabled(projectId: string): Promise<boolean> {
    const result = await this.pool.query(`SELECT artifacts_enabled FROM mlbox_projects WHERE id = $1`, [projectId]);
    return result.rows[0]?.artifacts_enabled === true;
  }

  async setProjectArtifactsEnabled(projectId: string, enabled: boolean): Promise<void> {
    await this.pool.query(`UPDATE mlbox_projects SET artifacts_enabled = $2 WHERE id = $1`, [projectId, enabled]);
  }

  // Ready artifact bytes in the Space, split into this Project and the others.
  // Ready, undeleted artifact bytes per Project in a Space, largest first.
  async storageByProject(spaceId: string): Promise<Array<{ projectId: string; name: string; bytes: number }>> {
    const result = await this.pool.query(
      `SELECT p.id, p.name, COALESCE(SUM(a.size_bytes), 0)::float AS bytes
       FROM mlbox_projects p
       JOIN mlbox_teams t ON t.id = p.team_id
       JOIN mlbox_artifacts a ON a.project_id = p.id AND a.status = 'ready' AND a.deleted_at IS NULL
       WHERE t.space_id = $1
       GROUP BY p.id, p.name
       ORDER BY bytes DESC`,
      [spaceId],
    );
    return result.rows.map((row) => ({ projectId: String(row.id), name: String(row.name), bytes: Number(row.bytes) }));
  }

  // Usage sessions of a Space in the last `days` days, newest first, with the credits each one used.
  async creditSessions(spaceId: string, days: number, limit: number): Promise<Array<{
    id: string; projectName: string; startedAt: Date; endedAt: Date | null; hours: number; credits: number;
  }>> {
    const result = await this.pool.query(
      `SELECT s.id, p.name AS project_name, s.started_at, s.ended_at,
              EXTRACT(EPOCH FROM (COALESCE(s.ended_at, now()) - s.started_at)) / 3600.0 AS hours,
              (EXTRACT(EPOCH FROM (COALESCE(s.ended_at, now()) - s.started_at)) / 3600.0 * s.units_per_hour)::float AS credits
       FROM mlbox_usage_sessions s
       JOIN mlbox_projects p ON p.id = s.project_id
       WHERE s.space_id = $1
         AND COALESCE(s.ended_at, now()) > date_trunc('day', now()) - ($2::int - 1) * interval '1 day'
       ORDER BY s.started_at DESC
       LIMIT $3`,
      [spaceId, days, limit],
    );
    return result.rows.map((row) => ({
      id: String(row.id),
      projectName: String(row.project_name),
      startedAt: new Date(String(row.started_at)),
      endedAt: row.ended_at ? new Date(String(row.ended_at)) : null,
      hours: Number(row.hours),
      credits: Number(row.credits),
    }));
  }

  // Daily credits used by a Space over the last `days` days (UTC). Each usage session is split across the days it overlaps.
  async creditHistory(spaceId: string, days: number): Promise<Array<{ date: string; credits: number }>> {
    const result = await this.pool.query(
      `SELECT to_char(d.day, 'YYYY-MM-DD') AS date,
              COALESCE(SUM(EXTRACT(EPOCH FROM (LEAST(COALESCE(s.ended_at, now()), d.day + interval '1 day') - GREATEST(s.started_at, d.day))) / 3600.0 * s.units_per_hour), 0)::float AS credits
       FROM generate_series(date_trunc('day', now()) - ($2::int - 1) * interval '1 day', date_trunc('day', now()), interval '1 day') AS d(day)
       LEFT JOIN mlbox_usage_sessions s ON s.space_id = $1 AND s.started_at < d.day + interval '1 day' AND COALESCE(s.ended_at, now()) > d.day
       GROUP BY d.day ORDER BY d.day`,
      [spaceId, days],
    );
    return result.rows.map((row) => ({ date: String(row.date), credits: Number(row.credits) }));
  }

  // Bytes of ready artifacts in a Space at the end of each day: stored from the day they were created until deleted.
  async storageHistory(spaceId: string, days: number): Promise<Array<{ date: string; bytes: number }>> {
    const result = await this.pool.query(
      `SELECT to_char(d.day, 'YYYY-MM-DD') AS date,
              COALESCE((
                SELECT SUM(a.size_bytes) FROM mlbox_artifacts a
                JOIN mlbox_projects p ON p.id = a.project_id
                JOIN mlbox_teams t ON t.id = p.team_id
                WHERE t.space_id = $1 AND a.status = 'ready'
                  AND a.created_at < d.day + interval '1 day'
                  AND (a.deleted_at IS NULL OR a.deleted_at >= d.day + interval '1 day')
              ), 0)::float AS bytes
       FROM generate_series(date_trunc('day', now()) - ($2::int - 1) * interval '1 day', date_trunc('day', now()), interval '1 day') AS d(day)
       ORDER BY d.day`,
      [spaceId, days],
    );
    return result.rows.map((row) => ({ date: String(row.date), bytes: Number(row.bytes) }));
  }

  // Sandboxes running in a Space right now: a usage session is open from start until stop.
  async openUsageSessionCount(spaceId: string): Promise<number> {
    const result = await this.pool.query(
      `SELECT count(*)::int AS running FROM mlbox_usage_sessions WHERE space_id = $1 AND ended_at IS NULL`,
      [spaceId],
    );
    return Number(result.rows[0]?.running ?? 0);
  }

  async artifactUsageForSpace(spaceId: string, projectId: string): Promise<{ projectBytes: number; otherProjectBytes: number }> {
    const result = await this.pool.query(
      `SELECT (p.id = $2) AS is_current, COALESCE(SUM(a.size_bytes), 0)::bigint AS bytes
       FROM mlbox_projects p
       JOIN mlbox_teams t ON t.id = p.team_id
       LEFT JOIN mlbox_artifacts a ON a.project_id = p.id AND a.status = 'ready' AND a.deleted_at IS NULL
       WHERE t.space_id = $1
       GROUP BY (p.id = $2)`,
      [spaceId, projectId],
    );
    let projectBytes = 0;
    let otherProjectBytes = 0;
    for (const row of result.rows) {
      if (row.is_current === true) projectBytes = Number(row.bytes);
      else otherProjectBytes += Number(row.bytes);
    }
    return { projectBytes, otherProjectBytes };
  }

  // Plan id of the Space's active subscription, or null when the Space has none (free tier defaults apply).
  async activePlanIdForSpace(spaceId: string): Promise<string | null> {
    const result = await this.pool.query(
      `SELECT plan FROM mlbox_space_subscriptions WHERE space_id = $1 AND status = 'active'`,
      [spaceId],
    );
    return result.rows[0] ? String(result.rows[0].plan) : null;
  }

  async listArtifactsCreatedBefore(projectId: string, cutoff: Date): Promise<ArtifactRecord[]> {
    const result = await this.pool.query(
      `SELECT id, project_id, name, object_key, content_type, size_bytes, status, created_by
       FROM mlbox_artifacts WHERE project_id = $1 AND deleted_at IS NULL AND created_at < $2`,
      [projectId, cutoff.toISOString()],
    );
    return result.rows.map(artifactFromRow);
  }

  async deleteArtifactRows(projectId: string, artifactIds: string[]): Promise<void> {
    if (artifactIds.length === 0) return;
    await this.pool.query(`UPDATE mlbox_artifacts SET deleted_at = now() WHERE project_id = $1 AND id = ANY($2::text[]) AND deleted_at IS NULL`, [projectId, artifactIds]);
  }

  // The Hub profile slug of the running (or last started) sandbox of a Project.
  // Soft delete: the Project row stays so usage history keeps its reference. The name is freed for reuse,
  // open usage sessions are closed, and artifact and sandbox rows are removed. Callers delete the stored
  // objects first and make sure the sandbox is not running.
  async deleteProject(projectId: string): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(
        `UPDATE mlbox_usage_sessions SET ended_at = now() WHERE project_id = $1 AND ended_at IS NULL`,
        [projectId],
      );
      await client.query(`UPDATE mlbox_artifacts SET deleted_at = now() WHERE project_id = $1 AND deleted_at IS NULL`, [projectId]);
      await client.query(`DELETE FROM mlbox_sandboxes WHERE project_id = $1`, [projectId]);
      await client.query(
        `UPDATE mlbox_projects SET deleted_at = now(), name = name || ' [deleted ' || id || ']' WHERE id = $1 AND deleted_at IS NULL`,
        [projectId],
      );
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async setSandboxProfile(projectId: string, profile: string): Promise<void> {
    await this.pool.query(`UPDATE mlbox_sandboxes SET profile = $2 WHERE project_id = $1`, [projectId, profile]);
  }

  async close(): Promise<void> {
    await this.pool.end();
  }
}
