import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import fastifyCookie from "@fastify/cookie";
import Fastify, { type FastifyReply, type FastifyRequest } from "fastify";

import { ActionError, ensureAdminAuditTable, loadAdminAudit, revokeSessions, setAccountEnabled, setSpacePlan, stopSandbox, validateReason, type ActionContext, type ActionDeps } from "./actions.js";
import { AwsInventory, LAYERS, type Layer, type Resource } from "./aws.js";
import { cached, clearCache, type Section } from "./cache.js";
import { classifyClaim, parseStorageToGiB, quotaLevel, type KnownProject } from "./capacity.js";
import { createHubClient } from "./hub.js";
import { effectivePlan, plansForSpaceType } from "./plans.js";
import { loadConfig } from "./config.js";
import { createSessionToken, LoginLimiter, safeEqual, verifyPassword, verifySessionToken } from "./auth.js";
import { createPool, createWritePool, loadAuditActions, loadAuditEvents, loadBillingSpaces, loadDbOverview, loadOpenSessions, loadRecentPayments, loadSandboxes, loadSpacePlans, loadStorageProjects, loadUnitsLast30Days, searchUsers, type Queryable } from "./db.js";
import { probeAll } from "./health.js";
import { contentSecurityPolicy, loadStaticFiles } from "./static-files.js";
import { loadCapacity, loadCluster, loadDeployments, loadVolumeClaims } from "./k8s.js";

const config = loadConfig();
const app = Fastify({ logger: { level: "info" }, trustProxy: true });
const limiter = new LoginLimiter();
const aws = new AwsInventory(config);
const pool = createPool(config);
const db: Queryable | null = pool;

// Changes are off unless switched on, and only then does a write-capable pool exist. If the audit table cannot be
// prepared the actions stay off: an action that cannot be recorded must not run.
const writePool = config.actionsEnabled ? createWritePool(config) : null;
let actionDeps: ActionDeps | null = null;
if (writePool) {
  try {
    await ensureAdminAuditTable(writePool);
    actionDeps = {
      pool: writePool,
      hub: config.hubUrl && config.hubApiToken ? createHubClient(config.hubUrl, config.hubApiToken) : null,
      cognito: aws.cognitoAdmin(),
    };
  } catch (error) {
    app.log.error({ err: error instanceof Error ? error.message : "error" }, "Admin actions disabled: the audit table is not available");
  }
}
const SESSION_COOKIE = "mlbox_admin";
// The exported console (web/admin/ui: `npm run build`, output in `out/`). The Docker image copies it to ./public.
const publicDir = process.env.ADMIN_UI_DIR ?? join(dirname(fileURLToPath(import.meta.url)), "..", "public");

type AuditEntry = { at: string; ip: string; action: string; detail?: string };
const adminAudit: AuditEntry[] = [];

/** There is a single administrator, so the trail is the process log plus a small in-memory window for the UI. */
function record(request: FastifyRequest, action: string, detail?: string): void {
  const entry: AuditEntry = { at: new Date().toISOString(), ip: request.ip, action, detail };
  adminAudit.unshift(entry);
  adminAudit.length = Math.min(adminAudit.length, 200);
  app.log.info({ admin_audit: entry }, "admin action");
}

app.register(fastifyCookie);

const staticFiles = loadStaticFiles(publicDir);
if (!staticFiles.has("/")) throw new Error(`No exported console found in ${publicDir}. Build web/admin/ui first.`);
for (const [route, file] of staticFiles) {
  app.get(route, async (_request, reply) => {
    reply.header("Content-Security-Policy", file.csp).header("Cache-Control", file.cache);
    return reply.type(file.type).send(file.body);
  });
}

app.addHook("onSend", async (_request, reply) => {
  reply.header("X-Content-Type-Options", "nosniff");
  reply.header("X-Frame-Options", "DENY");
  reply.header("Referrer-Policy", "no-referrer");
  if (!reply.hasHeader("cache-control")) reply.header("Cache-Control", "no-store");
  if (!reply.hasHeader("content-security-policy")) reply.header("Content-Security-Policy", contentSecurityPolicy());
});

const PUBLIC_API = new Set(["/api/login", "/api/session"]);

app.addHook("preHandler", async (request, reply) => {
  if (!request.url.startsWith("/api/") || PUBLIC_API.has(request.url.split("?")[0])) return;
  if (!verifySessionToken(config.sessionSecret, request.cookies[SESSION_COOKIE])) {
    return reply.code(401).send({ error: "UNAUTHENTICATED" });
  }
});

function setSessionCookie(reply: FastifyReply, token: string, maxAge: number): void {
  reply.setCookie(SESSION_COOKIE, token, { httpOnly: true, sameSite: "strict", secure: config.secureCookies, path: "/", maxAge });
}

// Liveness for the kubelet and ALB. It does not touch any dependency.
app.get("/healthz", async () => ({ ok: true }));

app.get("/api/session", async (request) => {
  const user = verifySessionToken(config.sessionSecret, request.cookies[SESSION_COOKIE]);
  return { authenticated: Boolean(user), user, features: { database: Boolean(db), actions: actionDeps !== null, costExplorer: config.costExplorerEnabled, domain: config.domain, cluster: config.clusterName, region: config.region } };
});

app.post<{ Body: { username?: unknown; password?: unknown } }>("/api/login", async (request, reply) => {
  // A cross-site form post cannot set a custom header, so this doubles as the CSRF check next to SameSite=Strict.
  if (request.headers["x-requested-with"] !== "mlbox-admin") return reply.code(400).send({ error: "BAD_REQUEST" });
  const retryAfter = limiter.retryAfter(request.ip);
  if (retryAfter > 0) {
    reply.header("Retry-After", String(retryAfter));
    return reply.code(429).send({ error: "TOO_MANY_ATTEMPTS", retryAfter });
  }
  const { username, password } = request.body ?? {};
  if (typeof username !== "string" || typeof password !== "string" || password.length > 256) return reply.code(400).send({ error: "BAD_REQUEST" });
  // Always verify the password so a wrong username costs the same time as a wrong password.
  const passwordOk = await verifyPassword(password, config.passwordHash);
  if (!(safeEqual(username, config.username) && passwordOk)) {
    limiter.recordFailure(request.ip);
    record(request, "login.failed");
    return reply.code(401).send({ error: "INVALID_CREDENTIALS" });
  }
  limiter.recordSuccess(request.ip);
  record(request, "login.succeeded");
  setSessionCookie(reply, createSessionToken(config.sessionSecret, config.username, config.sessionTtlSeconds), config.sessionTtlSeconds);
  return { ok: true, user: config.username };
});

app.post("/api/logout", async (request, reply) => {
  if (request.headers["x-requested-with"] !== "mlbox-admin") return reply.code(400).send({ error: "BAD_REQUEST" });
  record(request, "logout");
  reply.clearCookie(SESSION_COOKIE, { path: "/" });
  return { ok: true };
});

const noDatabase = (): Section<never> => ({ ok: false, error: "APP_DATABASE_URL is not configured", fetchedAt: new Date().toISOString() });

app.get("/api/overview", async (request) => {
  record(request, "view.overview");
  const [health, cluster, summary] = await Promise.all([
    cached("health", 15_000, () => probeAll(config.healthTargets)),
    cached("cluster", 30_000, loadCluster),
    db ? cached("db-overview", 30_000, () => loadDbOverview(db)) : Promise.resolve(noDatabase()),
  ]);
  return { health, cluster, summary };
});

app.get("/api/sandboxes", async (request) => {
  record(request, "view.sandboxes");
  if (!db) return { sandboxes: noDatabase(), sessions: noDatabase() };
  const [sandboxes, sessions] = await Promise.all([cached("sandboxes", 15_000, () => loadSandboxes(db)), cached("open-sessions", 15_000, () => loadOpenSessions(db))]);
  return { sandboxes, sessions };
});

app.get<{ Querystring: { q?: string } }>("/api/users", async (request, reply) => {
  const query = (request.query.q ?? "").trim();
  if (query.length < 2 || query.length > 100) return reply.code(400).send({ error: "QUERY_TOO_SHORT" });
  record(request, "search.users", query);
  if (!db) return noDatabase();
  return cached(`users:${query.toLowerCase()}`, 10_000, async () => {
    const users = await searchUsers(db, query);
    // Whether the account is locked lives in Cognito, so it is read there, for the first few matches only.
    return Promise.all(
      users.map(async (user, index) => {
        const withPlans = { ...user, spaces: user.spaces.map((space) => ({ ...space, alternatives: plansForSpaceType(String((space as Record<string, unknown>).space_type)).map((plan) => plan.id) })) };
        if (index >= 8) return { ...withPlans, cognito: null };
        try {
          return { ...withPlans, cognito: await aws.cognitoUserState(String((user as Record<string, unknown>).id)) };
        } catch {
          return { ...withPlans, cognito: null };
        }
      }),
    );
  });
});

app.get<{ Querystring: { action?: string; limit?: string } }>("/api/audit", async (request) => {
  const limit = Math.min(Math.max(Number(request.query.limit ?? 100) || 100, 1), 300);
  const action = (request.query.action ?? "").trim().slice(0, 60) || undefined;
  record(request, "view.audit", action);
  if (!db) return { events: noDatabase(), actions: noDatabase(), changes: noDatabase(), adminActions: adminAudit };
  const [events, actions, changes] = await Promise.all([
    cached(`audit:${action ?? ""}:${limit}`, 10_000, () => loadAuditEvents(db, { action, limit })),
    cached("audit-actions", 60_000, () => loadAuditActions(db)),
    cached("admin-changes", 10_000, () => loadAdminAudit(db)),
  ]);
  return { events, actions, changes, adminActions: adminAudit };
});

app.get("/api/deployments", async (request) => {
  record(request, "view.deployments");
  const [workloads, volumes] = await Promise.all([cached("deployments", 30_000, loadDeployments), cached("volumes", 60_000, loadVolumeClaims)]);
  return { workloads, volumes };
});

app.get("/api/aws", async (request) => {
  record(request, "view.aws");
  const collectors: Record<Layer, () => Promise<Resource[]>> = {
    edge: () => aws.edge(),
    network: () => aws.network(),
    compute: () => aws.compute(),
    data: () => aws.data(),
  };
  const layers = await Promise.all(
    LAYERS.map(async (layer) => ({ ...layer, section: await cached(`aws:${layer.id}`, 60_000, collectors[layer.id]) })),
  );
  return { region: config.region, cluster: config.clusterName, layers };
});

app.get("/api/cost", async (request, reply) => {
  record(request, "view.cost");
  if (!config.costExplorerEnabled) return reply.code(404).send({ error: "COST_EXPLORER_DISABLED" });
  // Each Cost Explorer request is billed, so the answer is cached for hours.
  return cached("cost", 6 * 60 * 60 * 1000, async () => {
    const cost = await aws.cost();
    const unitsLast30Days = db ? await loadUnitsLast30Days(db) : null;
    // The compute bill is the cost of running notebooks plus the idle system nodes, so the figure per unit is an upper bound.
    const compute = cost.services.find((service) => service.name.includes("Elastic Compute Cloud - Compute"))?.amount ?? null;
    return { ...cost, unitsLast30Days, computeCost: compute, costPerUnit: compute !== null && unitsLast30Days ? Math.round((compute / unitsLast30Days) * 1000) / 1000 : null };
  });
});

app.get("/api/capacity", async (request) => {
  record(request, "view.capacity");
  const [capacity, quotas] = await Promise.all([
    cached("capacity", 20_000, loadCapacity),
    cached("quotas", 60_000, async () => (await aws.vcpuQuotas()).map((quota) => ({ ...quota, level: quotaLevel(quota.limit, quota.used) }))),
  ]);
  return { capacity, quotas };
});

app.get("/api/storage", async (request) => {
  record(request, "view.storage");
  if (!db) return { volumes: noDatabase(), spaces: noDatabase(), projects: noDatabase() };
  const projects = await cached("storage-projects", 30_000, () => loadStorageProjects(db));
  const plans = await cached("space-plans", 30_000, () => loadSpacePlans(db));

  const volumes = await cached("storage-volumes", 30_000, async () => {
    const claims = await loadVolumeClaims();
    const known = new Map<string, KnownProject>();
    if (projects.ok) for (const row of projects.data) known.set(row.project_id, { name: row.project_name, spaceName: row.space_name, deleted: row.project_deleted_at !== null });
    return claims.map((claim) => ({ ...claim, ...classifyClaim(claim, known), sizeGiB: parseStorageToGiB(claim.size) }));
  });

  const spaces = !projects.ok
    ? projects
    : !plans.ok
      ? plans
      : await cached("storage-spaces", 30_000, async () => {
          const bytes = new Map<string, number>();
          for (const row of projects.data) bytes.set(row.space_id, (bytes.get(row.space_id) ?? 0) + Number(row.ready_bytes));
          return plans.data
            .map((space) => {
              const plan = effectivePlan(space.plan, space.status);
              return { id: space.id, name: space.name, type: space.type, plan: plan.id, bytes: bytes.get(space.id) ?? 0, limitGb: plan.storageGb };
            })
            .sort((a, b) => b.bytes - a.bytes);
        });
  return { volumes, spaces, projects };
});

app.get("/api/billing", async (request) => {
  record(request, "view.billing");
  if (!db) return { spaces: noDatabase(), payments: noDatabase() };
  const [spaces, payments] = await Promise.all([
    cached("billing-spaces", 30_000, async () =>
      (await loadBillingSpaces(db)).map((row) => {
        const plan = effectivePlan(row.plan, row.status);
        return { ...row, effectivePlan: plan.id, limit: plan.credits, alternatives: plansForSpaceType(row.type).map((item) => item.id) };
      }),
    ),
    cached("billing-payments", 30_000, () => loadRecentPayments(db)),
  ]);
  return { spaces, payments };
});

// ------------------------------------------------------------------ changes (off unless ADMIN_ACTIONS_ENABLED)

type ActionRequest = FastifyRequest<{ Body: { reason?: unknown } }>;

async function runAction(
  request: ActionRequest,
  reply: FastifyReply,
  name: string,
  target: string,
  run: (deps: ActionDeps, context: ActionContext) => Promise<{ auditId: string; detail: Record<string, unknown> }>,
) {
  if (!actionDeps) return reply.code(403).send({ error: "ACTIONS_DISABLED" });
  if (request.headers["x-requested-with"] !== "mlbox-admin") return reply.code(400).send({ error: "BAD_REQUEST" });
  const reason = validateReason(request.body?.reason);
  if (!reason) return reply.code(400).send({ error: "INVALID_REASON" });
  try {
    const result = await run(actionDeps, { ip: request.ip, reason });
    clearCache();
    record(request, `action.${name}`, target);
    return { ok: true, ...result };
  } catch (error) {
    if (error instanceof ActionError) {
      const status = { INVALID: 400, NOT_FOUND: 404, UNAVAILABLE: 503, UPSTREAM: 502 }[error.code];
      return reply.code(status).send({ error: error.code, message: error.message });
    }
    request.log.error({ err: error instanceof Error ? error.message : "error", action: name }, "Admin action failed");
    return reply.code(500).send({ error: "ACTION_FAILED" });
  }
}

const text = (value: unknown, max = 100): string | null => (typeof value === "string" && value.length > 0 && value.length <= max ? value : null);

app.post<{ Body: { projectId?: unknown; reason?: unknown } }>("/api/actions/sandbox/stop", async (request, reply) => {
  const projectId = text(request.body?.projectId);
  if (!projectId) return reply.code(400).send({ error: "BAD_REQUEST" });
  return runAction(request, reply, "sandbox.stop", projectId, (deps, context) => stopSandbox(deps, context, projectId));
});

app.post<{ Body: { userId?: unknown; reason?: unknown } }>("/api/actions/user/revoke-sessions", async (request, reply) => {
  const userId = text(request.body?.userId);
  if (!userId) return reply.code(400).send({ error: "BAD_REQUEST" });
  return runAction(request, reply, "user.revoke_sessions", userId, (deps, context) => revokeSessions(deps, context, userId));
});

app.post<{ Body: { userId?: unknown; enabled?: unknown; reason?: unknown } }>("/api/actions/user/account", async (request, reply) => {
  const userId = text(request.body?.userId);
  if (!userId || typeof request.body?.enabled !== "boolean") return reply.code(400).send({ error: "BAD_REQUEST" });
  const enabled = request.body.enabled;
  return runAction(request, reply, enabled ? "user.enable" : "user.disable", userId, (deps, context) => setAccountEnabled(deps, context, userId, enabled));
});

app.post<{ Body: { spaceId?: unknown; planId?: unknown; reason?: unknown } }>("/api/actions/space/plan", async (request, reply) => {
  const spaceId = text(request.body?.spaceId);
  const planId = text(request.body?.planId);
  if (!spaceId || !planId) return reply.code(400).send({ error: "BAD_REQUEST" });
  return runAction(request, reply, "space.set_plan", spaceId, (deps, context) => setSpacePlan(deps, context, spaceId, planId));
});

app.setNotFoundHandler((_request, reply) => reply.code(404).send({ error: "NOT_FOUND" }));

try {
  await app.listen({ port: config.port, host: config.host });
} catch (error) {
  app.log.error(error);
  process.exit(1);
}
