import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { Pool } from "pg";
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
      CREATE INDEX IF NOT EXISTS mlbox_space_memberships_user_idx ON mlbox_space_memberships(user_id, status);
      CREATE INDEX IF NOT EXISTS mlbox_projects_team_idx ON mlbox_projects(team_id);
      CREATE INDEX IF NOT EXISTS mlbox_project_access_user_idx ON mlbox_project_access(user_id);
      CREATE INDEX IF NOT EXISTS mlbox_payment_transactions_space_idx ON mlbox_payment_transactions(space_id, created_at DESC);
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
