import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import fastifyCookie from "@fastify/cookie";
import Fastify, { type FastifyReply, type FastifyRequest } from "fastify";

import { AwsInventory, LAYERS, type Layer, type Resource } from "./aws.js";
import { cached, type Section } from "./cache.js";
import { loadConfig } from "./config.js";
import { createSessionToken, LoginLimiter, safeEqual, verifyPassword, verifySessionToken } from "./auth.js";
import { createPool, loadAuditActions, loadAuditEvents, loadDbOverview, loadOpenSessions, loadSandboxes, searchUsers, type Queryable } from "./db.js";
import { probeAll } from "./health.js";
import { contentSecurityPolicy, loadStaticFiles } from "./static-files.js";
import { loadCluster, loadDeployments, loadVolumeClaims } from "./k8s.js";

const config = loadConfig();
const app = Fastify({ logger: { level: "info" }, trustProxy: true });
const limiter = new LoginLimiter();
const aws = new AwsInventory(config);
const pool = createPool(config);
const db: Queryable | null = pool;
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
  return { authenticated: Boolean(user), user, features: { database: Boolean(db), costExplorer: config.costExplorerEnabled, domain: config.domain, cluster: config.clusterName, region: config.region } };
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
  return cached(`users:${query.toLowerCase()}`, 10_000, () => searchUsers(db, query));
});

app.get<{ Querystring: { action?: string; limit?: string } }>("/api/audit", async (request) => {
  const limit = Math.min(Math.max(Number(request.query.limit ?? 100) || 100, 1), 300);
  const action = (request.query.action ?? "").trim().slice(0, 60) || undefined;
  record(request, "view.audit", action);
  if (!db) return { events: noDatabase(), actions: noDatabase(), adminActions: adminAudit };
  const [events, actions] = await Promise.all([
    cached(`audit:${action ?? ""}:${limit}`, 10_000, () => loadAuditEvents(db, { action, limit })),
    cached("audit-actions", 60_000, () => loadAuditActions(db)),
  ]);
  return { events, actions, adminActions: adminAudit };
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
  return cached("cost", 6 * 60 * 60 * 1000, () => aws.cost());
});

app.setNotFoundHandler((_request, reply) => reply.code(404).send({ error: "NOT_FOUND" }));

try {
  await app.listen({ port: config.port, host: config.host });
} catch (error) {
  app.log.error(error);
  process.exit(1);
}
