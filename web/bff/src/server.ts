import {
  CognitoIdentityProviderClient,
  ConfirmForgotPasswordCommand,
  ConfirmSignUpCommand,
  ForgotPasswordCommand,
  GetTokensFromRefreshTokenCommand,
  GlobalSignOutCommand,
  InitiateAuthCommand,
  RevokeTokenCommand,
  ChangePasswordCommand,
  GetUserCommand,
  ResendConfirmationCodeCommand,
  SignUpCommand,
  UpdateUserAttributesCommand,
  VerifyUserAttributeCommand,
} from "@aws-sdk/client-cognito-identity-provider";
import { DeleteItemCommand, DynamoDBClient, GetItemCommand, PutItemCommand } from "@aws-sdk/client-dynamodb";
import cookie from "@fastify/cookie";
import Fastify, { type FastifyReply, type FastifyRequest } from "fastify";
import { createHash, createSecretKey, randomBytes, randomUUID } from "node:crypto";
import { validCsrfPair } from "./csrf.js";
import { bearerMatches } from "./hub-bridge.js";
import { HANDOFF_TTL_SECONDS, buildHandoffUrl, generateHandoffCode, hashHandoffCode, sanitizeNextPath } from "./hub-handoff.js";
import { ensureHubUser, hubActivationState, hubActivationUrl, hubFailure, hubServerFromUserRecord, mapHubServerState, sandboxPath, sandboxUrl, startHubSandbox, type HubError, type HubRequestResponse, type HubLifecycleState, type HubServerLike } from "./hub.js";
import { requestHubResponse, resolveStartLifecycle, shouldStartHubSandbox, shouldUseHubActivationFallback } from "./lifecycle.js";
import {
  buildUsageResponse,
  checkRamQuota,
  parseCpuCores,
  parseMemoryGb,
  type UsageServer,
} from "./usage.js";
import { UsageStore } from "./usage-store.js";
import { listSingleuserPods, resourcesByServer } from "./pod-resources.js";
import { AppStore, INVITATION_NOT_AVAILABLE, LAST_TEAM_LEAD, PROJECT_RUNTIME_OWNER_NOT_READY, TEAM_MANAGEMENT_DENIED, type InvitationRole } from "./app-store.js";
import { ArtifactStorage } from "./artifact-storage.js";
import { deleteProjectClaim } from "./project-storage.js";
import { listSandboxProfiles, resolveSandboxProfile } from "./sandbox-profiles.js";
import { buildArtifactObjectKey, sanitizeArtifactName, validateArtifactSize } from "./artifacts.js";
import { describeUserAgent, parseProfileInput, validateAvatarDataUrl } from "./account.js";
import {
  canChangeMemberRole,
  canDeleteOrganization,
  canManageMembers,
  canRemoveMember,
  canTransferOwnership,
  deleteConfirmationMatches,
  isSpaceMemberRole,
  validateOrganizationName,
} from "./space-rules.js";
import { verifyTurnstile } from "./turnstile.js";
import {
  HubIdentityConflictError,
  persistResolvedHubIdentity,
  resolveAuthenticatedHubIdentity,
  type HubIdentityStore,
} from "./hub-identity-routing.js";
import type { HubIdentity } from "./hub-identity.js";
import {
  FREE_PLAN_ID,
  MAX_USAGE_SESSION_HOURS,
  artifactPolicyForPlan,
  getMockPlan,
  isMockPaymentMethod,
  isMockPaymentOutcome,
  listMockPlans,
  planAllowsRuntime,
  runtimeAccessDecision,
  runtimeClassForProfile,
  creditsPerHourForRuntime,
  type MockPaymentMethod,
  type MockPaymentOutcome,
  type SpaceType,
} from "./mock-billing.js";
import {
  CompactEncrypt,
  compactDecrypt,
  createRemoteJWKSet,
  jwtVerify,
  type JWTPayload,
  type JWTVerifyGetKey,
} from "jose";

function quotaEnv(name: string): number | undefined {
  const value = process.env[name];
  if (value === undefined || value.trim() === "") return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined;
}

const config = {
  port: Number(process.env.PORT ?? 4000),
  host: process.env.HOST ?? "0.0.0.0",
  region: process.env.AWS_REGION ?? process.env.AWS_DEFAULT_REGION ?? "ap-southeast-2",
  userPoolId: process.env.COGNITO_USER_POOL_ID,
  clientId: process.env.COGNITO_CLIENT_ID,
  sessionSecret: process.env.BFF_SESSION_SECRET,
  sessionsTable: process.env.MLBOX_SESSIONS_TABLE,
  hubUrl: process.env.HUB_URL?.replace(/\/$/, ""),
  hubPublicUrl: process.env.HUB_PUBLIC_URL?.replace(/\/$/, ""),
  hubApiToken: process.env.HUB_API_TOKEN,
  hubAuthBridgeToken: process.env.HUB_AUTH_BRIDGE_TOKEN,
  secureCookies: process.env.SECURE_COOKIES !== "false",
  cpuQuotaHours: quotaEnv("CPU_QUOTA_HOURS"),
  ramQuotaGb: quotaEnv("RAM_QUOTA_GB"),
  storageQuotaGb: quotaEnv("STORAGE_QUOTA_GB"),
  gpuQuotaHours: quotaEnv("GPU_QUOTA_HOURS"),
  appDatabaseUrl: process.env.USAGE_DATABASE_URL,
  turnstileRegisterEnabled: process.env.TURNSTILE_REGISTER_ENABLED === "true",
  turnstileCheckoutEnabled: process.env.TURNSTILE_CHECKOUT_ENABLED === "true",
  turnstileSecret: process.env.TURNSTILE_SECRET_KEY,
};

type RuntimeConfig = typeof config & {
  userPoolId: string;
  clientId: string;
  sessionSecret: string;
  sessionsTable: string;
  hubUrl: string;
  hubPublicUrl: string;
  hubApiToken: string;
  appDatabaseUrl?: string;
  turnstileRegisterEnabled: boolean;
  turnstileCheckoutEnabled: boolean;
  turnstileSecret?: string;
  cpuQuotaHours: number;
  ramQuotaGb: number;
  storageQuotaGb: number;
  gpuQuotaHours: number;
};

type Session = {
  sessionId: string;
  accessToken: string;
  email: string;
  username: string;
  expiresAt: number;
  subject: string;
};

type AuthBody = {
  email?: string;
  password?: string;
  turnstileToken?: string;
  currentPassword?: string;
  newPassword?: string;
};

type ConfirmBody = AuthBody & { code?: string };
type ResetBody = AuthBody & { code?: string; confirmationCode?: string; newPassword?: string };
type ProjectBody = { spaceId?: string; teamId?: string; name?: string };
type SubscriptionBody = { spaceId?: string; plan?: string; turnstileToken?: string };
type CheckoutBody = { spaceId?: string; planId?: string; paymentMethod?: MockPaymentMethod; mockOutcome?: MockPaymentOutcome; idempotencyKey?: string; turnstileToken?: string };
type RetryBody = { paymentMethod?: MockPaymentMethod; mockOutcome?: MockPaymentOutcome; idempotencyKey?: string; turnstileToken?: string };

type HubServer = {
  name?: string;
  state?: string;
  ready?: boolean;
  pending?: boolean;
  url?: string;
  last_activity?: string;
  cpu_limit?: unknown;
  mem_limit?: unknown;
  cpu_guarantee?: unknown;
  mem_guarantee?: unknown;
  resources?: { cpu?: unknown; memory?: unknown };
};

type HubUser = {
  name?: string;
  servers?: Record<string, HubServer>;
};


const SESSION_COOKIE = "mlbox_session";
const CSRF_COOKIE = "mlbox_csrf";
const SESSION_MAX_AGE = 60 * 60 * 8;
const cognito = new CognitoIdentityProviderClient({ region: config.region });
const dynamodb = new DynamoDBClient({ region: config.region });
const app = Fastify({ logger: true, bodyLimit: 64 * 1024 });
const usageStore = process.env.USAGE_DATABASE_URL ? new UsageStore(process.env.USAGE_DATABASE_URL) : null;
const appStore = process.env.USAGE_DATABASE_URL ? new AppStore(process.env.USAGE_DATABASE_URL) : null;
let usageSchemaReady: Promise<void> | null = null;
let appSchemaReady: Promise<void> | null = null;
let jwks: JWTVerifyGetKey | undefined;

function missingConfig(): string[] {
  return [
    "COGNITO_USER_POOL_ID",
    "COGNITO_CLIENT_ID",
    "BFF_SESSION_SECRET",
    "MLBOX_SESSIONS_TABLE",
    "HUB_URL",
    "HUB_PUBLIC_URL",
    "HUB_API_TOKEN",
    "CPU_QUOTA_HOURS",
    "RAM_QUOTA_GB",
    "STORAGE_QUOTA_GB",
    "GPU_QUOTA_HOURS",
  ].filter((name) => !process.env[name]);
}

function runtimeConfig(): RuntimeConfig {
  const missing = missingConfig();
  const invalid = ([
    ["CPU_QUOTA_HOURS", config.cpuQuotaHours],
    ["RAM_QUOTA_GB", config.ramQuotaGb],
    ["STORAGE_QUOTA_GB", config.storageQuotaGb],
    ["GPU_QUOTA_HOURS", config.gpuQuotaHours],
  ] as const).filter(([, value]) => value === undefined).map(([name]) => name);
  const errors = [...missing, ...invalid.filter((name) => !missing.includes(name))];
  if (errors.length > 0) throw new Error(`${errors.join(", ")} is required and must be a non-negative number`);
  return config as RuntimeConfig;
}

function issuerFor(runtime: RuntimeConfig): string {
  return `https://cognito-idp.${runtime.region}.amazonaws.com/${runtime.userPoolId}`;
}

function jwksFor(runtime: RuntimeConfig): JWTVerifyGetKey {
  return (jwks ??= createRemoteJWKSet(new URL(`${issuerFor(runtime)}/.well-known/jwks.json`)));
}

function sessionKeyFor(runtime: RuntimeConfig) {
  return createSecretKey(createHash("sha256").update(runtime.sessionSecret).digest());
}

function normalizeEmail(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const email = value.trim().toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : null;
}

function requiredString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

function errorName(error: unknown): string {
  return typeof error === "object" && error && "name" in error ? String(error.name) : "";
}

function authErrorStatus(error: unknown): number {
  switch (errorName(error)) {
    case "NotAuthorizedException":
    case "UserNotFoundException":
    case "PasswordResetRequiredException":
      return 401;
    case "UserNotConfirmedException":
      return 403;
    case "TooManyRequestsException":
    case "LimitExceededException":
      return 429;
    case "UsernameExistsException":
    case "CodeMismatchException":
    case "ExpiredCodeException":
    case "InvalidPasswordException":
    case "InvalidParameterException":
      return 400;
    default:
      return 502;
  }
}

function publicError(error: unknown): { error: string; message: string } {
  const name = errorName(error);
  const message =
    name === "UserNotFoundException" || name === "NotAuthorizedException"
      ? "Email hoặc mật khẩu không đúng."
      : name === "UserNotConfirmedException"
        ? "Tài khoản chưa được xác nhận."
        : name === "UsernameExistsException"
          ? "Email này đã được đăng ký."
          : name === "CodeMismatchException"
            ? "Mã xác nhận không đúng."
            : name === "ExpiredCodeException"
              ? "Mã xác nhận đã hết hạn."
              : name === "InvalidPasswordException"
                ? "Mật khẩu chưa đáp ứng chính sách bảo mật."
                : "Không thể hoàn tất yêu cầu xác thực.";
  return { error: name || "AUTH_ERROR", message };
}

async function encryptSession(runtime: RuntimeConfig, session: Session): Promise<string> {
  return new CompactEncrypt(new TextEncoder().encode(JSON.stringify(session)))
    .setProtectedHeader({ alg: "dir", enc: "A256GCM" })
    .encrypt(sessionKeyFor(runtime));
}

async function decryptSession(runtime: RuntimeConfig, value: string): Promise<Session> {
  const { plaintext } = await compactDecrypt(value, sessionKeyFor(runtime));
  const parsed = JSON.parse(new TextDecoder().decode(plaintext)) as Partial<Session>;
  if (
    typeof parsed.accessToken !== "string" ||
    typeof parsed.sessionId !== "string" ||
    typeof parsed.email !== "string" ||
    typeof parsed.username !== "string" ||
    typeof parsed.expiresAt !== "number" ||
    typeof parsed.subject !== "string"
  ) {
    throw new Error("Invalid session payload");
  }
  return parsed as Session;
}

async function setSessionCookie(reply: FastifyReply, runtime: RuntimeConfig, session: Session): Promise<void> {
  reply.setCookie(SESSION_COOKIE, await encryptSession(runtime, session), {
    httpOnly: true,
    secure: runtime.secureCookies,
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_MAX_AGE,
  });
}

function setCsrfCookie(reply: FastifyReply, secure: boolean): string {
  const token = randomBytes(32).toString("base64url");
  reply.setCookie(CSRF_COOKIE, token, { httpOnly: false, secure, sameSite: "lax", path: "/", maxAge: SESSION_MAX_AGE });
  return token;
}

function requireCsrf(request: FastifyRequest, reply: FastifyReply): boolean {
  const cookieToken = request.cookies[CSRF_COOKIE];
  const headerToken = request.headers["x-csrf-token"];
  if (!validCsrfPair(cookieToken, headerToken)) {
    reply.code(403).send({ error: "CSRF_INVALID", message: "Yêu cầu bảo mật không hợp lệ." });
    return false;
  }
  return true;
}

async function saveRefreshToken(runtime: RuntimeConfig, sessionId: string, refreshToken: string): Promise<void> {
  const encrypted = await new CompactEncrypt(new TextEncoder().encode(refreshToken))
    .setProtectedHeader({ alg: "dir", enc: "A256GCM" }).encrypt(sessionKeyFor(runtime));
  await dynamodb.send(new PutItemCommand({
    TableName: runtime.sessionsTable,
    Item: { sessionId: { S: sessionId }, refreshToken: { S: encrypted }, expiresAt: { N: String(Math.floor(Date.now() / 1000) + 30 * 24 * 60 * 60) } },
  }));
}

async function loadRefreshToken(runtime: RuntimeConfig, sessionId: string): Promise<string | null> {
  const result = await dynamodb.send(new GetItemCommand({ TableName: runtime.sessionsTable, Key: { sessionId: { S: sessionId } }, ConsistentRead: true }));
  const encrypted = result.Item?.refreshToken?.S;
  if (!encrypted) return null;
  const { plaintext } = await compactDecrypt(encrypted, sessionKeyFor(runtime));
  return new TextDecoder().decode(plaintext);
}

async function deleteRefreshToken(runtime: RuntimeConfig, sessionId: string): Promise<void> {
  await dynamodb.send(new DeleteItemCommand({ TableName: runtime.sessionsTable, Key: { sessionId: { S: sessionId } } }));
}

async function verifyAccessToken(runtime: RuntimeConfig, token: string): Promise<JWTPayload> {
  const { payload } = await jwtVerify(token, jwksFor(runtime), { issuer: issuerFor(runtime) });
  if (payload.token_use !== "access" || payload.client_id !== runtime.clientId) {
    throw new Error("Invalid Cognito access token");
  }
  return payload;
}

async function verifyIdToken(runtime: RuntimeConfig, token: string): Promise<JWTPayload> {
  const { payload } = await jwtVerify(token, jwksFor(runtime), {
    issuer: issuerFor(runtime),
    audience: runtime.clientId,
  });
  if (payload.token_use !== "id") throw new Error("Invalid Cognito ID token");
  return payload;
}

class AppDatabaseUnavailableError extends Error {}

async function ensureAppBootstrap(session: Session): Promise<void> {
  if (!appStore) return;
  appSchemaReady ??= appStore.ensureSchema();
  try {
    await appSchemaReady;
    await appStore.ensureUserBootstrap(session.subject, session.email);
  } catch (error) {
    appSchemaReady = null;
    throw new AppDatabaseUnavailableError("Application database unavailable", { cause: error });
  }
}

async function sessionFromRequest(request: FastifyRequest, allowExpired = false): Promise<Session> {
  const runtime = runtimeConfig();
  const cookieValue = request.cookies[SESSION_COOKIE];
  if (!cookieValue) throw new Error("Not authenticated");
  const session = await decryptSession(runtime, cookieValue);
  if (!allowExpired) {
    await verifyAccessToken(runtime, session.accessToken);
    if (session.expiresAt <= Math.floor(Date.now() / 1000)) throw new Error("Session expired");
  }
  return session;
}

async function requireSession(request: FastifyRequest, reply: FastifyReply): Promise<Session | null> {
  let session: Session;
  try {
    session = await sessionFromRequest(request);
  } catch {
    reply.code(401).send({ error: "UNAUTHENTICATED", message: "Phiên đăng nhập đã hết hạn." });
    return null;
  }
  try {
    await ensureAppBootstrap(session);
    if (appStore) {
      // A session revoked from the Security page is rejected even while its access token is still valid.
      if (!(await appStore.isAuthSessionActive(session.sessionId))) {
        reply.clearCookie(SESSION_COOKIE, { httpOnly: true, secure: runtimeConfig().secureCookies, sameSite: "lax", path: "/" });
        reply.code(401).send({ error: "UNAUTHENTICATED", message: "Phiên đăng nhập đã bị thu hồi." });
        return null;
      }
      await appStore.touchAuthSession(session.sessionId);
    }
    return session;
  } catch (error) {
    request.log.error({ err: error }, "Application database bootstrap failed");
    reply.code(503).send({ error: "APP_DATABASE_UNAVAILABLE", message: "Dịch vụ ứng dụng tạm thời không khả dụng." });
    return null;
  }
}

function usernamePath(username: string): string {
  return encodeURIComponent(username);
}

const emptyHubIdentityStore: HubIdentityStore = {
  getHubIdentity: async () => null,
  findHubIdentityByLegacyEmail: async () => null,
  listHubIdentityMappings: async () => [],
};

function hubIdentityStore(): HubIdentityStore {
  if (!appStore) return emptyHubIdentityStore;
  return {
    getHubIdentity: (userId) => appStore.getHubIdentity(userId),
    findHubIdentityByLegacyEmail: (email) => appStore.findHubIdentityByLegacyEmail(email),
    findLegacyHubIdentityByUser: (userId, email) => appStore.findLegacyHubIdentityByUser(userId, email),
    listHubIdentityMappings: () => appStore.listHubIdentityMappings(),
    upsertHubIdentity: (mapping) => appStore.upsertHubIdentity(mapping),
  };
}

async function resolveSessionHubIdentity(session: Session): Promise<HubIdentity> {
  return resolveAuthenticatedHubIdentity({ userId: session.subject, email: session.email, store: hubIdentityStore() });
}

async function persistSessionHubIdentity(identity: HubIdentity): Promise<void> {
  if (appStore) await persistResolvedHubIdentity(identity, { upsertHubIdentity: (mapping) => appStore.upsertHubIdentity(mapping) });
}

async function readHubServer(runtime: RuntimeConfig, username: string, name: string): Promise<HubServerLike | null> {
  const record = await hubRequest<unknown>(runtime, "GET", `/hub/api/users/${encodeURIComponent(username)}`);
  return hubServerFromUserRecord(record, name);
}

function serverPath(username: string, name: string): string {
  return sandboxPath(username, name);
}

// The Hub record has no resource figures, so running servers take CPU and RAM from their pod spec.
// A failed lookup leaves the figures unknown (shown as "—") rather than failing the usage page.
async function fillPodResources(servers: UsageServer[], username: string, log: { warn: (obj: unknown, msg: string) => void }): Promise<void> {
  if (!servers.some((server) => server.state === "running" && (server.cpuCoresAllocated == null || server.ramGbAllocated == null))) return;
  try {
    const byServer = resourcesByServer(await listSingleuserPods(username));
    for (const server of servers) {
      const figures = byServer.get(server.name || "default");
      if (!figures) continue;
      server.cpuCoresAllocated ??= figures.cpuCores;
      server.ramGbAllocated ??= figures.ramGb;
    }
  } catch (error) {
    log.warn({ err: error instanceof Error ? error.message : "pod_lookup_failed" }, "Pod resource lookup unavailable");
  }
}

function usageServer(key: string, server: HubServer): UsageServer {
  const resources = server.resources ?? {};
  return {
    name: server.name || key || "default",
    state: server.ready ? "running" : server.pending ? "pending" : "stopped",
    url: server.url ?? null,
    lastActivity: server.last_activity ?? null,
    cpuCoresAllocated: parseCpuCores(resources.cpu ?? server.cpu_limit ?? server.cpu_guarantee),
    ramGbAllocated: parseMemoryGb(resources.memory ?? server.mem_guarantee ?? server.mem_limit),
  };
}

async function auditLifecycle(session: Session, action: string, target: string, metadata: Record<string, unknown> = {}): Promise<void> {
  if (!appStore) return;
  try {
    await appStore.recordAuditEvent(session.subject, `personal:${session.subject}`, action, target, metadata);
  } catch (error) {
    app.log.warn({ err: error instanceof Error ? error.name : "audit_error", action, target }, "Sandbox lifecycle audit unavailable");
  }
}

async function hubRequestResponse<T>(runtime: RuntimeConfig, method: string, path: string, body?: unknown): Promise<HubRequestResponse<T>> {
  return requestHubResponse<T>({
    hubUrl: runtime.hubUrl,
    hubApiToken: runtime.hubApiToken,
    method,
    path,
    body,
  });
}

async function hubRequest<T>(runtime: RuntimeConfig, method: string, path: string, body?: unknown): Promise<T> {
  const response = await hubRequestResponse<T>(runtime, method, path, body);
  return response.body as T;
}

async function ensureRuntimeHubUser(runtime: RuntimeConfig, username: string): Promise<boolean> {
  const result = await ensureHubUser(username, async (method, path, body) => {
    await hubRequestResponse(runtime, method, path, body);
    return { status: 200 };
  });
  return result.created;
}

function hubStatus(error: unknown): number | null {
  if (typeof error !== "object" || error === null || !("status" in error)) return null;
  const value = Number((error as { status?: unknown }).status);
  return Number.isFinite(value) ? value : null;
}

function handleHubIdentityError(reply: FastifyReply, error: unknown): boolean {
  if (!(error instanceof HubIdentityConflictError)) return false;
  reply.code(409).send({
    error: "HUB_IDENTITY_CONFLICT",
    message: "Hub identity mapping requires manual review.",
  });
  return true;
}

function handleHubError(reply: FastifyReply, error: unknown): void {
  const failure = hubFailure(error);
  reply.code(failure.status).send({ error: failure.code, message: failure.message });
}

app.register(cookie);

// Protect every state-changing BFF endpoint, including public auth flows.
// The dashboard proxy obtains the double-submit token from /v1/auth/csrf.
app.addHook("onRequest", async (request, reply) => {
  if (["GET", "HEAD", "OPTIONS"].includes(request.method)) return;
  // Internal server-to-server routes authenticate with the bridge token instead of a browser CSRF pair.
  if (request.url.startsWith("/internal/")) return;
  requireCsrf(request, reply);
});

// Liveness: the process is up and its runtime configuration is complete. Does not touch the database,
// so a database outage cannot make the kubelet restart a healthy pod.
app.get("/v1/health/live", async (_request, reply) => {
  try {
    runtimeConfig();
    return { status: "ok", configured: true };
  } catch (error) {
    const missing = missingConfig();
    return reply.code(503).send({
      status: "degraded",
      configured: false,
      missing,
      message: error instanceof Error ? error.message : "Invalid runtime configuration",
    });
  }
});

// Readiness: configuration is complete AND the app database answers. Traffic is withheld while it does not.
app.get("/v1/health", async (request, reply) => {
  try {
    runtimeConfig();
  } catch (error) {
    const missing = missingConfig();
    return reply.code(503).send({
      status: "degraded",
      configured: false,
      missing,
      message: error instanceof Error ? error.message : "Invalid runtime configuration",
    });
  }
  if (appStore) {
    try {
      await appStore.ping();
    } catch (error) {
      request.log.error({ err: error }, "Readiness check: app database unreachable");
      return reply.code(503).send({ status: "degraded", configured: true, database: "unavailable" });
    }
  }
  return { status: "ok", configured: true, database: appStore ? "ok" : "not_configured" };
});

app.get("/v1/auth/csrf", async (_request, reply) => {
  reply.header("cache-control", "no-store");
  return { csrfToken: setCsrfCookie(reply, config.secureCookies) };
});

// Dashboard -> Hub: mint a one-time code for the signed-in user. The browser then opens the
// Hub login handler with the code; the Hub redeems it server-to-server (see /internal below).
app.post<{ Body: { path?: unknown } }>("/v1/hub/handoff", async (request, reply) => {
  reply.header("cache-control", "no-store");
  if (!appStore) return reply.code(503).send({ error: "APP_DATABASE_UNAVAILABLE", message: "Dịch vụ ứng dụng tạm thời không khả dụng." });
  const runtime = runtimeConfig();
  const session = await requireSession(request, reply);
  if (!session) return;
  const identity = await resolveSessionHubIdentity(session);
  if (identity.status === "conflict") return reply.code(409).send({ error: "HUB_IDENTITY_CONFLICT", message: "Tài khoản notebook đang cần kiểm tra." });
  await persistSessionHubIdentity(identity);
  const nextPath = sanitizeNextPath(request.body?.path);
  const code = generateHandoffCode();
  await appStore.createHubHandoffCode(hashHandoffCode(code), identity.hubUsername, nextPath, HANDOFF_TTL_SECONDS);
  return { url: buildHandoffUrl(runtime.hubPublicUrl, code, nextPath), expiresIn: HANDOFF_TTL_SECONDS };
});

// Internal only: the Hub redeems a handoff code from inside the cluster. The ALB never routes
// /internal, and the request is authenticated by the bridge token, not by a browser session.
app.post<{ Body: { code?: unknown } }>("/internal/v1/hub/handoff/redeem", async (request, reply) => {
  reply.header("cache-control", "no-store");
  if (!config.hubAuthBridgeToken) return reply.code(404).send({ error: "NOT_FOUND" });
  if (!bearerMatches(request.headers.authorization, config.hubAuthBridgeToken)) {
    return reply.code(401).send({ error: "UNAUTHORIZED" });
  }
  const code = typeof request.body?.code === "string" ? request.body.code : "";
  if (!code || code.length > 128 || !appStore) return reply.code(400).send({ error: "INVALID_CODE" });
  try {
    appSchemaReady ??= appStore.ensureSchema();
    await appSchemaReady;
    const redeemed = await appStore.redeemHubHandoffCode(hashHandoffCode(code));
    if (!redeemed) return reply.code(401).send({ error: "INVALID_OR_EXPIRED_CODE" });
    return redeemed;
  } catch (error) {
    appSchemaReady = null;
    request.log.error({ err: error }, "Hub handoff redeem failed");
    return reply.code(503).send({ error: "APP_DATABASE_UNAVAILABLE" });
  }
});

app.post<{ Body: AuthBody }>("/v1/auth/login", async (request, reply) => {
  const runtime = runtimeConfig();
  const email = normalizeEmail(request.body?.email);
  const password = requiredString(request.body?.password);
  if (!email || !password) return reply.code(400).send({ error: "INVALID_INPUT", message: "Email và mật khẩu là bắt buộc." });

  try {
    const result = await cognito.send(new InitiateAuthCommand({
      ClientId: runtime.clientId,
      AuthFlow: "USER_PASSWORD_AUTH",
      AuthParameters: { USERNAME: email, PASSWORD: password },
    }));
    if (result.ChallengeName || !result.AuthenticationResult?.AccessToken || !result.AuthenticationResult.IdToken) {
      return reply.code(409).send({ error: "AUTH_CHALLENGE_REQUIRED", message: "Tài khoản cần hoàn tất bước xác thực bổ sung." });
    }
    const idClaims = await verifyIdToken(runtime, result.AuthenticationResult.IdToken);
    const subject = typeof idClaims.sub === "string" ? idClaims.sub : null;
    if (!subject) throw new Error("Cognito ID token is missing sub");
    const sessionEmail = normalizeEmail(idClaims.email) ?? email;
    const session: Session = {
      sessionId: randomUUID(),
      // Only the access token rides in the session cookie: the full token set
      // inflates the encrypted JWE past the ~4 KB browser cookie limit and the
      // cookie would be silently dropped by browsers.
      accessToken: result.AuthenticationResult.AccessToken,
      email: sessionEmail,
      username: sessionEmail,
      subject,
      expiresAt: Math.floor(Date.now() / 1000) + (result.AuthenticationResult.ExpiresIn ?? 3600),
    };
    // Record the session first: if the app database is down, sign-in is refused up front instead of
    // issuing a cookie whose Security-page row and every authenticated call would then fail.
    await recordLoginSession(request, session);
    const refreshToken = result.AuthenticationResult.RefreshToken;
    if (refreshToken) await saveRefreshToken(runtime, session.sessionId, refreshToken);
    await setSessionCookie(reply, runtime, session);
    setCsrfCookie(reply, runtime.secureCookies);
    return { user: { email: session.email } };
  } catch (error) {
    if (error instanceof AppDatabaseUnavailableError) {
      request.log.error({ err: error }, "Login refused: app database unavailable");
      return reply.code(503).send(DB_UNAVAILABLE);
    }
    request.log.warn({ err: error }, "Cognito login failed");
    return reply.code(authErrorStatus(error)).send(publicError(error));
  }
});

app.post<{ Body: AuthBody }>("/v1/auth/forgot-password", async (request, reply) => {
  const runtime = runtimeConfig();
  const email = normalizeEmail(request.body?.email);
  if (!email) return reply.code(400).send({ error: "INVALID_INPUT", message: "Email không hợp lệ." });
  try {
    await cognito.send(new ForgotPasswordCommand({ ClientId: runtime.clientId, Username: email }));
    return { ok: true, message: "Nếu tài khoản tồn tại, hướng dẫn đặt lại mật khẩu sẽ được gửi đến email." };
  } catch (error) {
    request.log.warn({ err: error }, "Cognito forgot-password request failed");
    if (["UserNotFoundException", "LimitExceededException", "TooManyRequestsException"].includes(errorName(error))) {
      return { ok: true, message: "Nếu tài khoản tồn tại, hướng dẫn đặt lại mật khẩu sẽ được gửi đến email." };
    }
    return reply.code(authErrorStatus(error)).send(publicError(error));
  }
});

app.post<{ Body: ResetBody }>("/v1/auth/reset-password", async (request, reply) => {
  const runtime = runtimeConfig();
  const email = normalizeEmail(request.body?.email);
  const code = requiredString(request.body?.confirmationCode ?? request.body?.code);
  const password = requiredString(request.body?.newPassword ?? request.body?.password);
  if (!email || !code || !password) return reply.code(400).send({ error: "INVALID_INPUT", message: "Email, mã xác nhận và mật khẩu mới là bắt buộc." });
  try {
    await cognito.send(new ConfirmForgotPasswordCommand({ ClientId: runtime.clientId, Username: email, ConfirmationCode: code, Password: password }));
    return { ok: true };
  } catch (error) {
    request.log.warn({ err: error }, "Cognito password reset failed");
    return reply.code(authErrorStatus(error)).send(publicError(error));
  }
});

app.post<{ Body: AuthBody }>("/v1/auth/register", async (request, reply) => {
  const runtime = runtimeConfig();
  const email = normalizeEmail(request.body?.email);
  const password = requiredString(request.body?.password);
  if (!email || !password) return reply.code(400).send({ error: "INVALID_INPUT", message: "Email và mật khẩu là bắt buộc." });
  const turnstile = await verifyTurnstile({
    enabled: runtime.turnstileRegisterEnabled,
    token: request.body?.turnstileToken,
    secret: runtime.turnstileSecret,
    remoteIp: request.ip,
  });
  if (!turnstile.ok) return reply.code(403).send({ error: "TURNSTILE_REQUIRED", message: "Vui lòng hoàn tất xác minh bảo mật rồi thử lại." });
  try {
    const result = await cognito.send(new SignUpCommand({
      ClientId: runtime.clientId,
      Username: email,
      Password: password,
      UserAttributes: [{ Name: "email", Value: email }],
    }));
    return reply.code(201).send({ user: { email }, confirmed: result.UserConfirmed ?? false });
  } catch (error) {
    request.log.warn({ err: error }, "Cognito signup failed");
    return reply.code(authErrorStatus(error)).send(publicError(error));
  }
});

app.post<{ Body: ConfirmBody }>("/v1/auth/confirm", async (request, reply) => {
  const runtime = runtimeConfig();
  const email = normalizeEmail(request.body?.email);
  const code = requiredString(request.body?.code);
  if (!email || !code) return reply.code(400).send({ error: "INVALID_INPUT", message: "Email và mã xác nhận là bắt buộc." });
  try {
    await cognito.send(new ConfirmSignUpCommand({ ClientId: runtime.clientId, Username: email, ConfirmationCode: code }));
    return { confirmed: true };
  } catch (error) {
    request.log.warn({ err: error }, "Cognito confirmation failed");
    return reply.code(authErrorStatus(error)).send(publicError(error));
  }
});

app.post<{ Body: AuthBody }>("/v1/auth/resend-confirmation", async (request, reply) => {
  const runtime = runtimeConfig();
  const email = normalizeEmail(request.body?.email);
  if (!email) return reply.code(400).send({ error: "INVALID_INPUT", message: "Email không hợp lệ." });
  try {
    await cognito.send(new ResendConfirmationCodeCommand({ ClientId: runtime.clientId, Username: email }));
    return { ok: true };
  } catch (error) {
    request.log.warn({ err: error }, "Cognito confirmation resend failed");
    return reply.code(authErrorStatus(error)).send(publicError(error));
  }
});

app.get("/v1/auth/session", async (request, reply) => {
  const session = await requireSession(request, reply);
  if (!session) return;
  return { user: { email: session.email } };
});

app.post<{ Body: AuthBody }>("/v1/auth/change-password", async (request, reply) => {
  const session = await requireSession(request, reply);
  if (!session) return;
  const currentPassword = requiredString(request.body?.currentPassword);
  const newPassword = requiredString(request.body?.newPassword);
  if (!currentPassword || !newPassword) {
    return reply.code(400).send({ error: "INVALID_INPUT", message: "Mật khẩu hiện tại và mật khẩu mới là bắt buộc." });
  }
  try {
    await cognito.send(new ChangePasswordCommand({
      AccessToken: session.accessToken,
      PreviousPassword: currentPassword,
      ProposedPassword: newPassword,
    }));
    return { ok: true };
  } catch (error) {
    request.log.warn({ err: error }, "Cognito password change failed");
    return reply.code(authErrorStatus(error)).send(publicError(error));
  }
});

app.post("/v1/auth/refresh", async (request, reply) => {
  if (!requireCsrf(request, reply)) return;
  const runtime = runtimeConfig();
  let session: Session;
  try { session = await sessionFromRequest(request, true); } catch { return reply.code(401).send({ error: "UNAUTHENTICATED", message: "Phiên đăng nhập đã hết hạn." }); }
  const refreshToken = await loadRefreshToken(runtime, session.sessionId);
  if (!refreshToken) return reply.code(401).send({ error: "UNAUTHENTICATED", message: "Phiên đăng nhập đã hết hạn." });
  try {
    const result = await cognito.send(new GetTokensFromRefreshTokenCommand({ ClientId: runtime.clientId, RefreshToken: refreshToken }));
    const auth = result.AuthenticationResult;
    if (!auth?.AccessToken) throw new Error("Cognito refresh did not return an access token");
    await verifyAccessToken(runtime, auth.AccessToken);
    const updated: Session = { ...session, accessToken: auth.AccessToken, expiresAt: Math.floor(Date.now() / 1000) + (auth.ExpiresIn ?? 3600) };
    const rotatedToken = auth.RefreshToken;
    if (rotatedToken) await saveRefreshToken(runtime, session.sessionId, rotatedToken);
    await setSessionCookie(reply, runtime, updated);
    return { user: { email: session.email }, expiresAt: updated.expiresAt };
  } catch (error) {
    request.log.warn({ err: error }, "Cognito refresh failed");
    await deleteRefreshToken(runtime, session.sessionId).catch(() => undefined);
    reply.clearCookie(SESSION_COOKIE, { httpOnly: true, secure: runtime.secureCookies, sameSite: "lax", path: "/" });
    return reply.code(401).send({ error: "UNAUTHENTICATED", message: "Phiên đăng nhập đã hết hạn." });
  }
});

app.post("/v1/auth/logout", async (request, reply) => {
  if (!requireCsrf(request, reply)) return;
  const runtime = runtimeConfig();
  try {
    const session = await sessionFromRequest(request, true);
    const refreshToken = await loadRefreshToken(runtime, session.sessionId);
    await deleteRefreshToken(runtime, session.sessionId);
    if (refreshToken) {
      await cognito.send(new RevokeTokenCommand({ ClientId: runtime.clientId, Token: refreshToken })).catch((error) => request.log.warn({ err: error }, "Cognito refresh-token revoke failed"));
    }
    await cognito.send(new GlobalSignOutCommand({ AccessToken: session.accessToken })).catch((error) => request.log.warn({ err: error }, "Cognito global sign-out failed"));
  } catch (error) {
    request.log.info({ err: error }, "Session logout/revoke completed locally");
  }
  reply.clearCookie(SESSION_COOKIE, { httpOnly: true, secure: runtime.secureCookies, sameSite: "lax", path: "/" });
  reply.clearCookie(CSRF_COOKIE, { httpOnly: false, secure: runtime.secureCookies, sameSite: "lax", path: "/" });
  // The Hub keeps its own session cookie on the notebook host, which this origin cannot clear.
  // The dashboard navigates to this URL so JupyterHub drops its cookie as well.
  return { ok: true, hubLogoutUrl: runtime.hubPublicUrl ? `${runtime.hubPublicUrl}/hub/logout` : null };
});

// ---- Account: sessions, profile, avatar, email ----

const DB_UNAVAILABLE = { error: "APP_DATABASE_UNAVAILABLE", message: "Dịch vụ ứng dụng tạm thời không khả dụng." };

// Records the login so the Security page can list and revoke it. Errors propagate: a session that is
// not recorded would be rejected by requireSession later, so sign-in must fail instead of succeeding.
async function recordLoginSession(request: FastifyRequest, session: Session): Promise<void> {
  if (!appStore) return;
  await ensureAppBootstrap(session);
  try {
    await appStore.recordAuthSession(session.sessionId, session.subject, String(request.headers["user-agent"] ?? ""));
  } catch (error) {
    throw new AppDatabaseUnavailableError("Login session could not be recorded", { cause: error });
  }
}

// Drops the stored refresh token (so the session cannot refresh) and revokes it at Cognito.
async function revokeSessionTokens(runtime: RuntimeConfig, log: FastifyRequest["log"], sessionId: string): Promise<void> {
  const refreshToken = await loadRefreshToken(runtime, sessionId).catch(() => null);
  await deleteRefreshToken(runtime, sessionId).catch(() => undefined);
  if (refreshToken) {
    await cognito.send(new RevokeTokenCommand({ ClientId: runtime.clientId, Token: refreshToken }))
      .catch((error) => log.warn({ err: error }, "Cognito refresh-token revoke failed"));
  }
}

function clearSessionCookie(reply: FastifyReply, runtime: RuntimeConfig): void {
  reply.clearCookie(SESSION_COOKIE, { httpOnly: true, secure: runtime.secureCookies, sameSite: "lax", path: "/" });
}

app.get("/v1/account/profile", async (request, reply) => {
  const session = await requireSession(request, reply);
  if (!session) return;
  if (!appStore) return reply.code(503).send(DB_UNAVAILABLE);
  try {
    const profile = await appStore.getAccountProfile(session.subject);
    if (!profile) return reply.code(404).send({ error: "NOT_FOUND", message: "Tài khoản không tồn tại." });
    return { profile };
  } catch (error) {
    request.log.error({ err: error }, "Account profile read failed");
    return reply.code(503).send(DB_UNAVAILABLE);
  }
});

app.put<{ Body: Record<string, unknown> | undefined }>("/v1/account/profile", async (request, reply) => {
  if (!requireCsrf(request, reply)) return;
  const session = await requireSession(request, reply);
  if (!session) return;
  if (!appStore) return reply.code(503).send(DB_UNAVAILABLE);
  const input = parseProfileInput(request.body);
  if (!input) return reply.code(400).send({ error: "INVALID_INPUT", message: "Thông tin hồ sơ không hợp lệ." });
  try {
    await appStore.updateAccountProfile(session.subject, input);
    return { ok: true };
  } catch (error) {
    request.log.error({ err: error }, "Account profile update failed");
    return reply.code(503).send(DB_UNAVAILABLE);
  }
});

// The avatar is a small, browser-resized data URL. The route raises the body limit only for this path.
app.put<{ Body: { dataUrl?: unknown } | undefined }>("/v1/account/avatar", { bodyLimit: 320 * 1024 }, async (request, reply) => {
  if (!requireCsrf(request, reply)) return;
  const session = await requireSession(request, reply);
  if (!session) return;
  if (!appStore) return reply.code(503).send(DB_UNAVAILABLE);
  const raw = request.body?.dataUrl;
  let dataUrl: string | null = null;
  if (raw !== null) {
    dataUrl = validateAvatarDataUrl(raw);
    if (!dataUrl) return reply.code(400).send({ error: "INVALID_INPUT", message: "Ảnh đại diện phải là PNG, JPEG hoặc WebP dưới 200 KB." });
  }
  try {
    await appStore.setAvatarDataUrl(session.subject, dataUrl);
    return { ok: true, avatarDataUrl: dataUrl };
  } catch (error) {
    request.log.error({ err: error }, "Avatar update failed");
    return reply.code(503).send(DB_UNAVAILABLE);
  }
});

// Step 1 of an email change: Cognito emails a code to the new address. The current email stays active until step 2.
app.post<{ Body: { email?: unknown } | undefined }>("/v1/account/email", async (request, reply) => {
  if (!requireCsrf(request, reply)) return;
  const session = await requireSession(request, reply);
  if (!session) return;
  const email = normalizeEmail(request.body?.email);
  if (!email) return reply.code(400).send({ error: "INVALID_INPUT", message: "Email không hợp lệ." });
  if (email === session.email) return reply.code(400).send({ error: "INVALID_INPUT", message: "Email mới phải khác email hiện tại." });
  try {
    await cognito.send(new UpdateUserAttributesCommand({
      AccessToken: session.accessToken,
      UserAttributes: [{ Name: "email", Value: email }],
    }));
    return { ok: true, pendingEmail: email };
  } catch (error) {
    request.log.warn({ err: error }, "Cognito email change request failed");
    return reply.code(authErrorStatus(error)).send(publicError(error));
  }
});

// Step 2: the code proves ownership. The new address is read back from Cognito, never taken from the request.
app.post<{ Body: { code?: unknown } | undefined }>("/v1/account/email/verify", async (request, reply) => {
  if (!requireCsrf(request, reply)) return;
  const session = await requireSession(request, reply);
  if (!session) return;
  const code = requiredString(request.body?.code);
  if (!code) return reply.code(400).send({ error: "INVALID_INPUT", message: "Mã xác nhận là bắt buộc." });
  const runtime = runtimeConfig();
  try {
    await cognito.send(new VerifyUserAttributeCommand({ AccessToken: session.accessToken, AttributeName: "email", Code: code }));
    const user = await cognito.send(new GetUserCommand({ AccessToken: session.accessToken }));
    const email = normalizeEmail(user.UserAttributes?.find((attribute) => attribute.Name === "email")?.Value);
    if (!email) throw new Error("Cognito did not return the verified email");
    if (appStore) await appStore.setUserEmail(session.subject, email);
    await setSessionCookie(reply, runtime, { ...session, email, username: email });
    return { ok: true, user: { email } };
  } catch (error) {
    request.log.warn({ err: error }, "Cognito email verification failed");
    return reply.code(authErrorStatus(error)).send(publicError(error));
  }
});

app.get("/v1/account/sessions", async (request, reply) => {
  const session = await requireSession(request, reply);
  if (!session) return;
  if (!appStore) return reply.code(503).send(DB_UNAVAILABLE);
  try {
    const rows = await appStore.listAuthSessions(session.subject);
    return {
      sessions: rows.map((row) => ({
        id: row.sessionId,
        label: describeUserAgent(row.userAgent),
        // null → the dashboard shows its localized "unknown browser" text.
        createdAt: row.createdAt,
        lastSeenAt: row.lastSeenAt,
        current: row.sessionId === session.sessionId,
      })),
    };
  } catch (error) {
    request.log.error({ err: error }, "Session list failed");
    return reply.code(503).send(DB_UNAVAILABLE);
  }
});

app.delete<{ Params: { sessionId: string } }>("/v1/account/sessions/:sessionId", async (request, reply) => {
  if (!requireCsrf(request, reply)) return;
  const session = await requireSession(request, reply);
  if (!session) return;
  if (!appStore) return reply.code(503).send(DB_UNAVAILABLE);
  const runtime = runtimeConfig();
  const targetId = request.params.sessionId;
  try {
    if (!(await appStore.revokeAuthSession(session.subject, targetId))) {
      return reply.code(404).send({ error: "NOT_FOUND", message: "Phiên đăng nhập không tồn tại." });
    }
    await revokeSessionTokens(runtime, request.log, targetId);
    const current = targetId === session.sessionId;
    if (current) clearSessionCookie(reply, runtime);
    return { ok: true, current };
  } catch (error) {
    request.log.error({ err: error }, "Session revoke failed");
    return reply.code(503).send(DB_UNAVAILABLE);
  }
});

app.post("/v1/account/sessions/revoke-others", async (request, reply) => {
  if (!requireCsrf(request, reply)) return;
  const session = await requireSession(request, reply);
  if (!session) return;
  if (!appStore) return reply.code(503).send(DB_UNAVAILABLE);
  const runtime = runtimeConfig();
  try {
    const revokedIds = await appStore.revokeOtherAuthSessions(session.subject, session.sessionId);
    for (const id of revokedIds) await revokeSessionTokens(runtime, request.log, id);
    return { ok: true, revoked: revokedIds.length };
  } catch (error) {
    request.log.error({ err: error }, "Revoking other sessions failed");
    return reply.code(503).send(DB_UNAVAILABLE);
  }
});

app.get<{ Querystring: { spaceId?: string } }>("/v1/projects", async (request, reply) => {
  const session = await requireSession(request, reply);
  if (!session) return;
  if (!appStore) return reply.code(503).send({ error: "APP_DATABASE_UNAVAILABLE", message: "Project storage is not configured." });
  const spaceId = requiredString(request.query.spaceId) ?? `personal:${session.subject}`;
  try {
    const projects = await appStore.listProjects(session.subject, spaceId);
    // canManage decides whether the UI offers project deletion; the DELETE route checks it again.
    const withPermissions = await Promise.all(projects.map(async (project) => ({
      ...project,
      canManage: (await appStore!.projectPermission(session.subject, project.id))?.canManage ?? false,
    })));
    return { spaceId, projects: withPermissions };
  } catch (error) {
    request.log.error({ err: error }, "Project list failed");
    return reply.code(503).send({ error: "APP_DATABASE_UNAVAILABLE", message: "Project storage is temporarily unavailable." });
  }
});

// Deleting a Project needs manager rights and a stopped sandbox. Stored artifacts are removed from S3
// before the rows, so a failure part-way leaves the Project listed and the delete can be retried.
app.delete<{ Params: { projectId: string } }>("/v1/projects/:projectId", async (request, reply) => {
  if (!requireCsrf(request, reply)) return;
  const session = await requireSession(request, reply);
  if (!session) return;
  if (!appStore) return reply.code(503).send({ error: "APP_DATABASE_UNAVAILABLE", message: "Project storage is not configured." });
  const projectId = request.params.projectId;
  try {
    const permission = await appStore.projectPermission(session.subject, projectId);
    if (!permission) return reply.code(404).send({ error: "NOT_FOUND", message: "Project không tồn tại." });
    if (!permission.canManage) return reply.code(403).send({ error: "FORBIDDEN", message: "Chỉ người quản lý Project mới được xóa." });

    const runtime = await appStore.getProjectSandboxRuntime(projectId);
    if (runtime) {
      const hub = runtimeConfig();
      const server = await readHubServer(hub, runtime.hubUsername, runtime.serverName).catch((error) => {
        if (hubStatus(error) === 404) return null;
        throw error;
      });
      const state = mapHubServerState(server);
      if (state === "ready" || state === "starting") {
        return reply.code(409).send({ error: "SANDBOX_RUNNING", message: "Dừng sandbox trước khi xóa Project." });
      }
    }

    const stored = await appStore.listArtifacts(projectId);
    if (stored.length > 0) {
      if (!artifactStorage) return reply.code(503).send({ error: "ARTIFACTS_NOT_CONFIGURED", message: "Artifact storage is not configured." });
      for (const artifact of stored) await artifactStorage.deleteObject(artifact.objectKey);
    }
    // The notebook storage claim goes too, so the files are removed with the Project.
    await deleteProjectClaim(projectId);
    await appStore.deleteProject(projectId);
    return { ok: true, deletedArtifacts: stored.length };
  } catch (error) {
    if (handleHubIdentityError(reply, error)) return;
    request.log.error({ err: error }, "Project delete failed");
    return reply.code(503).send({ error: "APP_DATABASE_UNAVAILABLE", message: "Không thể xóa Project lúc này. Vui lòng thử lại." });
  }
});

app.get<{ Querystring: { spaceType?: string } }>("/v1/subscriptions/plans", async (request, reply) => {
  const requestedType = request.query.spaceType;
  if (requestedType !== undefined && requestedType !== "personal" && requestedType !== "organization") {
    return reply.code(400).send({ error: "INVALID_INPUT", message: "Space type is invalid." });
  }
  return { plans: listMockPlans(requestedType as SpaceType | undefined) };
});

app.get<{ Querystring: { spaceId?: string } }>("/v1/subscription", async (request, reply) => {
  const session = await requireSession(request, reply);
  if (!session) return;
  if (!appStore) return reply.code(503).send({ error: "APP_DATABASE_UNAVAILABLE", message: "Subscription storage is not configured." });
  const spaceId = requiredString(request.query.spaceId) ?? `personal:${session.subject}`;
  try {
    const details = await appStore.getSubscriptionDetails(session.subject, spaceId);
    if (!details) return reply.code(403).send({ error: "FORBIDDEN", message: "You do not have access to this Space." });
    return details;
  } catch (error) {
    request.log.error({ err: error }, "Subscription lookup failed");
    return reply.code(503).send({ error: "APP_DATABASE_UNAVAILABLE", message: "Subscription storage is temporarily unavailable." });
  }
});

app.get<{ Querystring: { spaceId?: string } }>("/v1/payments", async (request, reply) => {
  const session = await requireSession(request, reply);
  if (!session) return;
  if (!appStore) return reply.code(503).send({ error: "APP_DATABASE_UNAVAILABLE", message: "Payment storage is not configured." });
  const spaceId = requiredString(request.query.spaceId) ?? `personal:${session.subject}`;
  try {
    return { spaceId, payments: await appStore.listPayments(session.subject, spaceId) };
  } catch (error) {
    request.log.error({ err: error }, "Payment history lookup failed");
    return reply.code(503).send({ error: "APP_DATABASE_UNAVAILABLE", message: "Payment storage is temporarily unavailable." });
  }
});

// A personal Space is bought by its user. An organization's subscription is bought by its owner only.
async function canBuySubscription(userId: string, spaceId: string): Promise<boolean> {
  if (!appStore || spaceId.startsWith("personal:")) return true;
  const space = (await appStore.listSpaces(userId)).find((item) => item.id === spaceId);
  if (!space || space.type !== "organization") return true;
  return space.role === "owner";
}

app.post<{ Body: CheckoutBody }>("/v1/subscriptions/mock/checkout", async (request, reply) => {
  if (!requireCsrf(request, reply)) return;
  const session = await requireSession(request, reply);
  if (!session) return;
  if (!appStore) return reply.code(503).send({ error: "APP_DATABASE_UNAVAILABLE", message: "Subscription storage is not configured." });
  const spaceId = requiredString(request.body?.spaceId) ?? `personal:${session.subject}`;
  if (!(await canBuySubscription(session.subject, spaceId))) return reply.code(403).send({ error: "FORBIDDEN", message: "Chỉ owner mới mua subscription cho nhóm." });
  const planId = requiredString(request.body?.planId);
  const paymentMethod = request.body?.paymentMethod;
  const mockOutcome = request.body?.mockOutcome;
  const idempotencyKey = requiredString(request.body?.idempotencyKey);
  if (!planId || !paymentMethod || !mockOutcome || !idempotencyKey) return reply.code(400).send({ error: "INVALID_INPUT", message: "Plan, payment method, outcome, and idempotency key are required." });
  if (!isMockPaymentMethod(paymentMethod)) return reply.code(400).send({ error: "INVALID_PAYMENT_METHOD", message: "The mock payment method is invalid." });
  if (!isMockPaymentOutcome(mockOutcome)) return reply.code(400).send({ error: "INVALID_PAYMENT_OUTCOME", message: "The mock payment outcome is invalid." });
  const plan = getMockPlan(planId);
  if (!plan) return reply.code(400).send({ error: "INVALID_PLAN", message: "The selected demo plan is invalid." });
  if (plan.status !== "active") return reply.code(409).send({ error: "PLAN_UNAVAILABLE", message: "This demo plan is coming soon." });
  const spaceType = await appStore.getSpaceType(session.subject, spaceId);
  if (!spaceType || spaceType !== plan.spaceType) return reply.code(400).send({ error: "SPACE_PLAN_MISMATCH", message: "This plan is not available for the selected Space." });
  const runtime = runtimeConfig();
  const turnstile = await verifyTurnstile({ enabled: runtime.turnstileCheckoutEnabled, token: request.body?.turnstileToken, secret: runtime.turnstileSecret, remoteIp: request.ip });
  if (!turnstile.ok) return reply.code(403).send({ error: "TURNSTILE_REQUIRED", message: "Vui lòng hoàn tất xác minh bảo mật rồi thử lại." });
  try {
    if (plan.amountCents === 0) {
      if (plan.id !== "personal_free") return reply.code(400).send({ error: "INVALID_PLAN", message: "The selected free plan is invalid." });
      const result = await appStore.activateFreeSubscription(session.subject, spaceId, plan);
      const details = await appStore.getSubscriptionDetails(session.subject, spaceId);
      return { payment: null, subscription: result.subscription, entitlements: details?.entitlements ?? result.entitlements };
    }
    return await appStore.createMockCheckout(session.subject, { spaceId, planId, amountCents: plan.amountCents, paymentMethod, outcome: mockOutcome, idempotencyKey });
  } catch (error) {
    if (error instanceof Error && error.message === "Subscription access denied") return reply.code(403).send({ error: "FORBIDDEN", message: "You do not have permission to manage this Space subscription." });
    if (error instanceof Error && error.message === "Space type mismatch") return reply.code(400).send({ error: "SPACE_PLAN_MISMATCH", message: "This plan is not available for the selected Space." });
    request.log.error({ err: error }, "Mock checkout failed");
    return reply.code(503).send({ error: "APP_DATABASE_UNAVAILABLE", message: "Subscription storage is temporarily unavailable." });
  }
});

app.post<{ Params: { paymentId: string }; Body: RetryBody }>("/v1/payments/mock/:paymentId/retry", async (request, reply) => {
  if (!requireCsrf(request, reply)) return;
  const session = await requireSession(request, reply);
  if (!session) return;
  if (!appStore) return reply.code(503).send({ error: "APP_DATABASE_UNAVAILABLE", message: "Payment storage is not configured." });
  const paymentMethod = request.body?.paymentMethod;
  const mockOutcome = request.body?.mockOutcome;
  const idempotencyKey = requiredString(request.body?.idempotencyKey);
  if (!paymentMethod || !mockOutcome || !idempotencyKey) return reply.code(400).send({ error: "INVALID_INPUT", message: "Payment method, outcome, and idempotency key are required." });
  if (!isMockPaymentMethod(paymentMethod)) return reply.code(400).send({ error: "INVALID_PAYMENT_METHOD", message: "The mock payment method is invalid." });
  if (!isMockPaymentOutcome(mockOutcome)) return reply.code(400).send({ error: "INVALID_PAYMENT_OUTCOME", message: "The mock payment outcome is invalid." });
  const runtime = runtimeConfig();
  const turnstile = await verifyTurnstile({ enabled: runtime.turnstileCheckoutEnabled, token: request.body?.turnstileToken, secret: runtime.turnstileSecret, remoteIp: request.ip });
  if (!turnstile.ok) return reply.code(403).send({ error: "TURNSTILE_REQUIRED", message: "Vui lòng hoàn tất xác minh bảo mật rồi thử lại." });
  try {
    const result = await appStore.retryMockPayment(session.subject, request.params.paymentId, { paymentMethod, outcome: mockOutcome, idempotencyKey });
    return result;
  } catch (error) {
    if (error instanceof Error && error.message === "Subscription access denied") return reply.code(403).send({ error: "FORBIDDEN", message: "You do not have permission to manage this payment." });
    if (error instanceof Error && error.message === "Payment cannot be retried") return reply.code(409).send({ error: "PAYMENT_NOT_RETRYABLE", message: "This payment cannot be retried." });
    request.log.error({ err: error }, "Mock payment retry failed");
    return reply.code(503).send({ error: "APP_DATABASE_UNAVAILABLE", message: "Payment storage is temporarily unavailable." });
  }
});

app.post<{ Body: { spaceId?: string } }>("/v1/subscription/cancel", async (request, reply) => {
  if (!requireCsrf(request, reply)) return;
  const session = await requireSession(request, reply);
  if (!session) return;
  if (!appStore) return reply.code(503).send({ error: "APP_DATABASE_UNAVAILABLE", message: "Subscription storage is not configured." });
  const spaceId = requiredString(request.body?.spaceId) ?? `personal:${session.subject}`;
  try {
    return { subscription: await appStore.cancelMockSubscription(session.subject, spaceId) };
  } catch (error) {
    if (error instanceof Error && error.message === "Subscription access denied") return reply.code(403).send({ error: "FORBIDDEN", message: "You do not have permission to cancel this subscription." });
    request.log.error({ err: error }, "Mock subscription cancellation failed");
    return reply.code(503).send({ error: "APP_DATABASE_UNAVAILABLE", message: "Subscription storage is temporarily unavailable." });
  }
});

app.post<{ Body: SubscriptionBody }>("/v1/subscriptions/mock", async (request, reply) => {
  if (!requireCsrf(request, reply)) return;
  const session = await requireSession(request, reply);
  if (!session) return;
  if (!appStore) return reply.code(503).send({ error: "APP_DATABASE_UNAVAILABLE", message: "Subscription storage is not configured." });
  const spaceId = requiredString(request.body?.spaceId) ?? `personal:${session.subject}`;
  if (!(await canBuySubscription(session.subject, spaceId))) return reply.code(403).send({ error: "FORBIDDEN", message: "Chỉ owner mới mua subscription cho nhóm." });
  const plan = requiredString(request.body?.plan);
  if (!plan) return reply.code(400).send({ error: "INVALID_INPUT", message: "Subscription plan is required." });
  const turnstile = await verifyTurnstile({
    enabled: runtimeConfig().turnstileCheckoutEnabled,
    token: request.body?.turnstileToken,
    secret: runtimeConfig().turnstileSecret,
    remoteIp: request.ip,
  });
  if (!turnstile.ok) return reply.code(403).send({ error: "TURNSTILE_REQUIRED", message: "Vui lòng hoàn tất xác minh bảo mật rồi thử lại." });
  try {
    return { subscription: await appStore.activateMockSubscription(session.subject, spaceId, plan) };
  } catch (error) {
    if (error instanceof Error && error.message === "Subscription access denied") {
      return reply.code(403).send({ error: "FORBIDDEN", message: "Bạn không có quyền cập nhật subscription của Space này." });
    }
    request.log.error({ err: error }, "Mock subscription activation failed");
    return reply.code(503).send({ error: "APP_DATABASE_UNAVAILABLE", message: "Subscription storage is temporarily unavailable." });
  }
});

app.post<{ Body: ProjectBody }>("/v1/projects", async (request, reply) => {
  if (!requireCsrf(request, reply)) return;
  const session = await requireSession(request, reply);
  if (!session) return;
  if (!appStore) return reply.code(503).send({ error: "APP_DATABASE_UNAVAILABLE", message: "Project storage is not configured." });
  const spaceId = requiredString(request.body?.spaceId) ?? `personal:${session.subject}`;
  const teamId = requiredString(request.body?.teamId) ?? `personal-team:${session.subject}`;
  const name = requiredString(request.body?.name);
  if (!name) return reply.code(400).send({ error: "INVALID_INPUT", message: "Project name is required." });
  try {
    // The number of kept Projects is not capped; once the plan's storage is used up, no new Project can be created.
    const policy = await artifactPolicy(appStore, spaceId);
    if (policy.storageGb !== null) {
      const usage = await appStore.artifactUsageForSpace(spaceId, "");
      const usedBytes = usage.projectBytes + usage.otherProjectBytes;
      if (usedBytes >= policy.storageGb * GIB) {
        return reply.code(429).send({
          error: "QUOTA_EXCEEDED",
          metric: "storage",
          limit: policy.storageGb,
          current: usedBytes / GIB,
          enforcement: "enforced",
          message: "Đã hết dung lượng lưu trữ của gói. Xoá bớt file hoặc nâng gói để tạo Project mới.",
        });
      }
    }
    return reply.code(201).send({ project: await appStore.createProject(session.subject, spaceId, teamId, name) });
  } catch (error) {
    if (error instanceof Error && error.message === "Project team access denied") {
      return reply.code(403).send({ error: "FORBIDDEN", message: "Bạn không có quyền tạo Project trong Space này." });
    }
    request.log.error({ err: error }, "Project creation failed");
    return reply.code(503).send({ error: "APP_DATABASE_UNAVAILABLE", message: "Project storage is temporarily unavailable." });
  }
});

app.get("/v1/spaces", async (request, reply) => {
  const session = await requireSession(request, reply);
  if (!session) return;
  if (!appStore) return reply.code(503).send({ error: "APP_DATABASE_UNAVAILABLE", message: "Space storage is not configured." });
  try {
    return { spaces: await appStore.listSpaces(session.subject) };
  } catch (error) {
    request.log.error({ err: error }, "Space list failed");
    return reply.code(503).send({ error: "APP_DATABASE_UNAVAILABLE", message: "Space storage is temporarily unavailable." });
  }
});

// ---- Organizations (Spaces). Personal Spaces are not managed through these routes.

app.post<{ Body: { name?: unknown } }>("/v1/spaces", async (request, reply) => {
  if (!requireCsrf(request, reply)) return;
  const session = await requireSession(request, reply);
  if (!session) return;
  if (!appStore) return reply.code(503).send({ error: "APP_DATABASE_UNAVAILABLE", message: "Space storage is not configured." });
  const name = validateOrganizationName(request.body?.name);
  if (!name.ok) return reply.code(400).send({ error: "INVALID_NAME", message: "Tên nhóm từ 1 đến 60 ký tự." });
  try {
    const created = await appStore.createOrganization(session.subject, name.value);
    return reply.code(201).send({ space: { id: created.spaceId, type: "organization", name: name.value, role: "owner" } });
  } catch (error) {
    request.log.error({ err: error }, "Organization create failed");
    return reply.code(503).send({ error: "APP_DATABASE_UNAVAILABLE", message: "Space storage is temporarily unavailable." });
  }
});

app.get<{ Params: { spaceId: string } }>("/v1/spaces/:spaceId/members", async (request, reply) => {
  const session = await requireSession(request, reply);
  if (!session) return;
  if (!appStore) return reply.code(503).send({ error: "APP_DATABASE_UNAVAILABLE", message: "Space storage is not configured." });
  try {
    const { spaceId } = request.params;
    const role = await appStore.activeSpaceRole(session.subject, spaceId);
    if (!role) return reply.code(404).send({ error: "NOT_FOUND", message: "Nhóm không tồn tại." });
    return { spaceId, role, members: await appStore.listSpaceMembers(spaceId) };
  } catch (error) {
    request.log.error({ err: error }, "Space member list failed");
    return reply.code(503).send({ error: "APP_DATABASE_UNAVAILABLE", message: "Space storage is temporarily unavailable." });
  }
});

app.patch<{ Params: { spaceId: string; userId: string }; Body: { role?: unknown } }>("/v1/spaces/:spaceId/members/:userId", async (request, reply) => {
  if (!requireCsrf(request, reply)) return;
  const session = await requireSession(request, reply);
  if (!session) return;
  if (!appStore) return reply.code(503).send({ error: "APP_DATABASE_UNAVAILABLE", message: "Space storage is not configured." });
  const { spaceId, userId } = request.params;
  const next = request.body?.role;
  if (!isSpaceMemberRole(next)) return reply.code(400).send({ error: "INVALID_ROLE", message: "Vai trò không hợp lệ." });
  try {
    const actor = await appStore.activeSpaceRole(session.subject, spaceId);
    if (!canManageMembers(actor)) return reply.code(403).send({ error: "FORBIDDEN", message: "Chỉ owner hoặc admin mới quản lý thành viên." });
    const target = (await appStore.listSpaceMembers(spaceId)).find((member) => member.userId === userId);
    if (!target) return reply.code(404).send({ error: "NOT_FOUND", message: "Thành viên không tồn tại." });
    if (!canChangeMemberRole(actor, target.role, next)) return reply.code(403).send({ error: "FORBIDDEN", message: "Bạn không thể đổi vai trò này." });
    await appStore.setSpaceMemberRole(spaceId, userId, next);
    return { ok: true };
  } catch (error) {
    request.log.error({ err: error }, "Space member role update failed");
    return reply.code(503).send({ error: "APP_DATABASE_UNAVAILABLE", message: "Space storage is temporarily unavailable." });
  }
});

app.post<{ Params: { spaceId: string }; Body: { userId?: unknown } }>("/v1/spaces/:spaceId/transfer-ownership", async (request, reply) => {
  if (!requireCsrf(request, reply)) return;
  const session = await requireSession(request, reply);
  if (!session) return;
  if (!appStore) return reply.code(503).send({ error: "APP_DATABASE_UNAVAILABLE", message: "Space storage is not configured." });
  const { spaceId } = request.params;
  const userId = typeof request.body?.userId === "string" ? request.body.userId : "";
  if (!userId) return reply.code(400).send({ error: "INVALID_USER", message: "Chọn admin nhận quyền owner." });
  try {
    const actor = await appStore.activeSpaceRole(session.subject, spaceId);
    const target = (await appStore.listSpaceMembers(spaceId)).find((member) => member.userId === userId);
    if (!target) return reply.code(404).send({ error: "NOT_FOUND", message: "Thành viên không tồn tại." });
    if (!canTransferOwnership(actor, target.role)) return reply.code(403).send({ error: "FORBIDDEN", message: "Chỉ owner mới chuyển quyền owner cho một admin." });
    await appStore.transferSpaceOwnership(spaceId, session.subject, userId);
    return { ok: true };
  } catch (error) {
    request.log.error({ err: error }, "Space ownership transfer failed");
    return reply.code(503).send({ error: "APP_DATABASE_UNAVAILABLE", message: "Space storage is temporarily unavailable." });
  }
});

app.delete<{ Params: { spaceId: string; userId: string } }>("/v1/spaces/:spaceId/members/:userId", async (request, reply) => {
  if (!requireCsrf(request, reply)) return;
  const session = await requireSession(request, reply);
  if (!session) return;
  if (!appStore) return reply.code(503).send({ error: "APP_DATABASE_UNAVAILABLE", message: "Space storage is not configured." });
  const { spaceId, userId } = request.params;
  try {
    const actor = await appStore.activeSpaceRole(session.subject, spaceId);
    if (!canManageMembers(actor)) return reply.code(403).send({ error: "FORBIDDEN", message: "Chỉ owner hoặc admin mới quản lý thành viên." });
    const target = (await appStore.listSpaceMembers(spaceId)).find((member) => member.userId === userId);
    if (!target) return reply.code(404).send({ error: "NOT_FOUND", message: "Thành viên không tồn tại." });
    if (!canRemoveMember(actor, target.role)) return reply.code(403).send({ error: "FORBIDDEN", message: "Bạn không thể xoá thành viên này." });
    await appStore.removeSpaceMember(spaceId, userId);
    return { ok: true };
  } catch (error) {
    request.log.error({ err: error }, "Space member removal failed");
    return reply.code(503).send({ error: "APP_DATABASE_UNAVAILABLE", message: "Space storage is temporarily unavailable." });
  }
});

// Deleting an organization ends it for everyone. Running sandboxes block it; the owner must type the name.
app.post<{ Params: { spaceId: string }; Body: { confirmName?: unknown } }>("/v1/spaces/:spaceId/delete", async (request, reply) => {
  if (!requireCsrf(request, reply)) return;
  const session = await requireSession(request, reply);
  if (!session) return;
  if (!appStore) return reply.code(503).send({ error: "APP_DATABASE_UNAVAILABLE", message: "Space storage is not configured." });
  const { spaceId } = request.params;
  try {
    const actor = await appStore.activeSpaceRole(session.subject, spaceId);
    if (!canDeleteOrganization(actor)) return reply.code(403).send({ error: "FORBIDDEN", message: "Chỉ owner mới xoá nhóm." });
    const space = (await appStore.listSpaces(session.subject)).find((item) => item.id === spaceId);
    if (!space || space.type !== "organization") return reply.code(404).send({ error: "NOT_FOUND", message: "Nhóm không tồn tại." });
    if (!deleteConfirmationMatches(space.name, request.body?.confirmName)) {
      return reply.code(400).send({ error: "CONFIRMATION_MISMATCH", message: "Tên xác nhận không khớp." });
    }

    const projectIds = await appStore.listProjectIdsInSpace(spaceId);
    const hub = runtimeConfig();
    for (const projectId of projectIds) {
      const runtime = await appStore.getProjectSandboxRuntime(projectId);
      if (!runtime) continue;
      const server = await readHubServer(hub, runtime.hubUsername, runtime.serverName).catch((error) => {
        if (hubStatus(error) === 404) return null;
        throw error;
      });
      const state = mapHubServerState(server);
      if (state === "ready" || state === "starting") {
        return reply.code(409).send({ error: "SANDBOX_RUNNING", message: "Dừng tất cả sandbox trước khi xoá nhóm." });
      }
    }

    for (const projectId of projectIds) {
      const stored = await appStore.listArtifacts(projectId);
      if (stored.length > 0) {
        if (!artifactStorage) return reply.code(503).send({ error: "ARTIFACTS_NOT_CONFIGURED", message: "Artifact storage is not configured." });
        for (const artifact of stored) await artifactStorage.deleteObject(artifact.objectKey);
      }
      await deleteProjectClaim(projectId);
    }
    await appStore.deleteOrganization(spaceId);
    return { ok: true, deletedProjects: projectIds.length };
  } catch (error) {
    if (handleHubIdentityError(reply, error)) return;
    request.log.error({ err: error }, "Organization delete failed");
    return reply.code(503).send({ error: "APP_DATABASE_UNAVAILABLE", message: "Không thể xoá nhóm lúc này. Vui lòng thử lại." });
  }
});

const USAGE_NOTE ="Số giờ được ghi nhận từ lần khởi động/dừng sandbox qua BFF; không phải dữ liệu thanh toán.";

app.get<{ Params: { projectId: string } }>("/v1/projects/:projectId/usage", async (request, reply) => {
  const session = await requireSession(request, reply);
  if (!session) return;
  if (!appStore) return reply.code(503).send({ error: "APP_DATABASE_UNAVAILABLE", message: "Usage storage is not configured." });
  try {
    if (!(await projectActionAllowed(reply, session.subject, request.params.projectId, "read"))) return;
    return { projectId: request.params.projectId, usage: await appStore.projectUsageSummary(request.params.projectId, 30), note: USAGE_NOTE };
  } catch (error) {
    request.log.error({ err: error }, "Project usage read failed");
    return reply.code(503).send({ error: "APP_DATABASE_UNAVAILABLE", message: "Usage storage is temporarily unavailable." });
  }
});

app.get<{ Params: { spaceId: string } }>("/v1/spaces/:spaceId/usage", async (request, reply) => {
  const session = await requireSession(request, reply);
  if (!session) return;
  if (!appStore) return reply.code(503).send({ error: "APP_DATABASE_UNAVAILABLE", message: "Usage storage is not configured." });
  try {
    const summary = await appStore.spaceUsageSummary(session.subject, request.params.spaceId, 30);
    if (!summary) return reply.code(404).send({ error: "NOT_FOUND", message: "Space không tồn tại hoặc bạn không thuộc Space này." });
    return { ...summary, note: USAGE_NOTE };
  } catch (error) {
    request.log.error({ err: error }, "Space usage read failed");
    return reply.code(503).send({ error: "APP_DATABASE_UNAVAILABLE", message: "Usage storage is temporarily unavailable." });
  }
});

const INVITATION_ROLES: InvitationRole[] = ["admin", "member", "viewer"];

app.post<{ Params: { spaceId: string }; Body: { email?: string; role?: string } }>("/v1/spaces/:spaceId/invitations", async (request, reply) => {
  if (!requireCsrf(request, reply)) return;
  const session = await requireSession(request, reply);
  if (!session) return;
  if (!appStore) return reply.code(503).send({ error: "APP_DATABASE_UNAVAILABLE", message: "Invitation storage is not configured." });
  const email = requiredString(request.body?.email)?.toLowerCase();
  const role = request.body?.role ?? "member";
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return reply.code(400).send({ error: "INVALID_INPUT", message: "Email không hợp lệ." });
  if (!INVITATION_ROLES.includes(role as InvitationRole)) return reply.code(400).send({ error: "INVALID_INPUT", message: "Vai trò không hợp lệ." });
  try {
    return reply.code(201).send({ invitation: await appStore.createSpaceInvitation(session.subject, request.params.spaceId, email, role as InvitationRole) });
  } catch (error) {
    if (error instanceof Error && error.message === TEAM_MANAGEMENT_DENIED) {
      return reply.code(403).send({ error: "FORBIDDEN", message: "Bạn không có quyền mời thành viên vào nhóm này." });
    }
    request.log.error({ err: error }, "Invitation create failed");
    return reply.code(503).send({ error: "APP_DATABASE_UNAVAILABLE", message: "Invitation storage is temporarily unavailable." });
  }
});

app.get<{ Params: { spaceId: string } }>("/v1/spaces/:spaceId/invitations", async (request, reply) => {
  const session = await requireSession(request, reply);
  if (!session) return;
  if (!appStore) return reply.code(503).send({ error: "APP_DATABASE_UNAVAILABLE", message: "Invitation storage is not configured." });
  try {
    return { spaceId: request.params.spaceId, invitations: await appStore.listSpaceInvitations(session.subject, request.params.spaceId) };
  } catch (error) {
    request.log.error({ err: error }, "Invitation list failed");
    return reply.code(503).send({ error: "APP_DATABASE_UNAVAILABLE", message: "Invitation storage is temporarily unavailable." });
  }
});

app.delete<{ Params: { spaceId: string; invitationId: string } }>("/v1/spaces/:spaceId/invitations/:invitationId", async (request, reply) => {
  if (!requireCsrf(request, reply)) return;
  const session = await requireSession(request, reply);
  if (!session) return;
  if (!appStore) return reply.code(503).send({ error: "APP_DATABASE_UNAVAILABLE", message: "Invitation storage is not configured." });
  try {
    await appStore.revokeSpaceInvitation(session.subject, request.params.spaceId, request.params.invitationId);
    return { ok: true };
  } catch (error) {
    if (error instanceof Error && error.message === TEAM_MANAGEMENT_DENIED) {
      return reply.code(403).send({ error: "FORBIDDEN", message: "Bạn không có quyền thu hồi lời mời này." });
    }
    request.log.error({ err: error }, "Invitation revoke failed");
    return reply.code(503).send({ error: "APP_DATABASE_UNAVAILABLE", message: "Invitation storage is temporarily unavailable." });
  }
});

app.get("/v1/invitations", async (request, reply) => {
  const session = await requireSession(request, reply);
  if (!session) return;
  if (!appStore) return reply.code(503).send({ error: "APP_DATABASE_UNAVAILABLE", message: "Invitation storage is not configured." });
  try {
    return { invitations: await appStore.listMyInvitations(session.email) };
  } catch (error) {
    request.log.error({ err: error }, "Own invitation list failed");
    return reply.code(503).send({ error: "APP_DATABASE_UNAVAILABLE", message: "Invitation storage is temporarily unavailable." });
  }
});

app.post<{ Params: { invitationId: string } }>("/v1/invitations/:invitationId/accept", async (request, reply) => {
  if (!requireCsrf(request, reply)) return;
  const session = await requireSession(request, reply);
  if (!session) return;
  if (!appStore) return reply.code(503).send({ error: "APP_DATABASE_UNAVAILABLE", message: "Invitation storage is not configured." });
  try {
    await appStore.acceptSpaceInvitation(session.subject, session.email, request.params.invitationId);
    return { ok: true };
  } catch (error) {
    if (error instanceof Error && error.message === INVITATION_NOT_AVAILABLE) {
      return reply.code(404).send({ error: "NOT_FOUND", message: "Lời mời không tồn tại hoặc không dành cho tài khoản này." });
    }
    request.log.error({ err: error }, "Invitation accept failed");
    return reply.code(503).send({ error: "APP_DATABASE_UNAVAILABLE", message: "Invitation storage is temporarily unavailable." });
  }
});

// Teams (flat, per Space). Owners/admins manage teams; members are added by Cognito sub for now.
app.get<{ Params: { spaceId: string } }>("/v1/spaces/:spaceId/teams", async (request, reply) => {
  const session = await requireSession(request, reply);
  if (!session) return;
  if (!appStore) return reply.code(503).send({ error: "APP_DATABASE_UNAVAILABLE", message: "Team storage is not configured." });
  try {
    return { spaceId: request.params.spaceId, teams: await appStore.listTeams(session.subject, request.params.spaceId) };
  } catch (error) {
    request.log.error({ err: error }, "Team list failed");
    return reply.code(503).send({ error: "APP_DATABASE_UNAVAILABLE", message: "Team storage is temporarily unavailable." });
  }
});

app.post<{ Params: { spaceId: string }; Body: { name?: string } }>("/v1/spaces/:spaceId/teams", async (request, reply) => {
  if (!requireCsrf(request, reply)) return;
  const session = await requireSession(request, reply);
  if (!session) return;
  if (!appStore) return reply.code(503).send({ error: "APP_DATABASE_UNAVAILABLE", message: "Team storage is not configured." });
  const name = requiredString(request.body?.name);
  if (!name) return reply.code(400).send({ error: "INVALID_INPUT", message: "Team name is required." });
  try {
    return reply.code(201).send({ team: await appStore.createTeam(session.subject, request.params.spaceId, name) });
  } catch (error) {
    if (error instanceof Error && error.message === TEAM_MANAGEMENT_DENIED) {
      return reply.code(403).send({ error: "FORBIDDEN", message: "Bạn không có quyền quản lý Team trong Space này." });
    }
    request.log.error({ err: error }, "Team creation failed");
    return reply.code(503).send({ error: "APP_DATABASE_UNAVAILABLE", message: "Team storage is temporarily unavailable." });
  }
});

app.get<{ Params: { spaceId: string; teamId: string } }>("/v1/spaces/:spaceId/teams/:teamId/members", async (request, reply) => {
  const session = await requireSession(request, reply);
  if (!session) return;
  if (!appStore) return reply.code(503).send({ error: "APP_DATABASE_UNAVAILABLE", message: "Team storage is not configured." });
  try {
    return { teamId: request.params.teamId, members: await appStore.listTeamMembers(session.subject, request.params.spaceId, request.params.teamId) };
  } catch (error) {
    request.log.error({ err: error }, "Team member list failed");
    return reply.code(503).send({ error: "APP_DATABASE_UNAVAILABLE", message: "Team storage is temporarily unavailable." });
  }
});

app.post<{ Params: { spaceId: string; teamId: string }; Body: { userId?: string; role?: string } }>(
  "/v1/spaces/:spaceId/teams/:teamId/members",
  async (request, reply) => {
    if (!requireCsrf(request, reply)) return;
    const session = await requireSession(request, reply);
    if (!session) return;
    if (!appStore) return reply.code(503).send({ error: "APP_DATABASE_UNAVAILABLE", message: "Team storage is not configured." });
    const userId = requiredString(request.body?.userId);
    const role = request.body?.role ?? "member";
    if (!userId) return reply.code(400).send({ error: "INVALID_INPUT", message: "User ID is required." });
    if (role !== "lead" && role !== "member") return reply.code(400).send({ error: "INVALID_INPUT", message: "Team role is invalid." });
    try {
      await appStore.addTeamMember(session.subject, request.params.spaceId, request.params.teamId, userId, role);
      return reply.code(201).send({ ok: true });
    } catch (error) {
      if (error instanceof Error && error.message === LAST_TEAM_LEAD) {
        return reply.code(409).send({ error: "LAST_TEAM_LEAD", message: "Team phải có ít nhất một lead." });
      }
      if (error instanceof Error && error.message === TEAM_MANAGEMENT_DENIED) {
        return reply.code(403).send({ error: "FORBIDDEN", message: "Bạn không có quyền quản lý thành viên Team này." });
      }
      request.log.error({ err: error }, "Team member add failed");
      return reply.code(503).send({ error: "APP_DATABASE_UNAVAILABLE", message: "Team storage is temporarily unavailable." });
    }
  },
);

app.delete<{ Params: { spaceId: string; teamId: string; userId: string } }>(
  "/v1/spaces/:spaceId/teams/:teamId/members/:userId",
  async (request, reply) => {
    if (!requireCsrf(request, reply)) return;
    const session = await requireSession(request, reply);
    if (!session) return;
    if (!appStore) return reply.code(503).send({ error: "APP_DATABASE_UNAVAILABLE", message: "Team storage is not configured." });
    try {
      await appStore.removeTeamMember(session.subject, request.params.spaceId, request.params.teamId, request.params.userId);
      return { ok: true };
    } catch (error) {
      if (error instanceof Error && error.message === LAST_TEAM_LEAD) {
        return reply.code(409).send({ error: "LAST_TEAM_LEAD", message: "Team phải có ít nhất một lead." });
      }
      if (error instanceof Error && error.message === TEAM_MANAGEMENT_DENIED) {
        return reply.code(403).send({ error: "FORBIDDEN", message: "Bạn không có quyền quản lý thành viên Team này." });
      }
      request.log.error({ err: error }, "Team member removal failed");
      return reply.code(503).send({ error: "APP_DATABASE_UNAVAILABLE", message: "Team storage is temporarily unavailable." });
    }
  },
);

// Project-scoped sandbox runtime (phase 4): authorization is per Project; the Hub server runs
// under the Project owner's Hub user, and the owner's identity is only used as the runtime holder.
async function projectActionAllowed(reply: FastifyReply, userId: string, projectId: string, action: "read" | "operate"): Promise<boolean> {
  const permission = await appStore!.projectPermission(userId, projectId);
  if (!permission) {
    reply.code(404).send({ error: "NOT_FOUND", message: "Project không tồn tại hoặc bạn không có quyền truy cập." });
    return false;
  }
  if (action === "operate" && !permission.canOperate) {
    reply.code(403).send({ error: "FORBIDDEN", message: "Bạn không có quyền vận hành Sandbox của Project này." });
    return false;
  }
  return true;
}

app.get<{ Params: { projectId: string } }>("/v1/projects/:projectId/sandbox", async (request, reply) => {
  const session = await requireSession(request, reply);
  if (!session) return;
  if (!appStore) return reply.code(503).send({ error: "APP_DATABASE_UNAVAILABLE", message: "Project storage is not configured." });
  const { projectId } = request.params;
  try {
    if (!(await projectActionAllowed(reply, session.subject, projectId, "read"))) return;
    const permission = await appStore.projectPermission(session.subject, projectId);
    const runtime = await appStore.getProjectSandboxRuntime(projectId);
    // The Project's last started profile; null before its first start, which launches the default.
    const preferredProfile = runtime?.profile ?? null;
    if (!runtime) return { projectId, canOperate: permission?.canOperate ?? false, preferredProfile, sandbox: null };
    const hub = runtimeConfig();
    const server = await readHubServer(hub, runtime.hubUsername, runtime.serverName).catch((error) => {
      if (hubStatus(error) === 404) return null;
      throw error;
    });
    const observedState = mapHubServerState(server);
    if (observedState !== "ready" && observedState !== "starting") await appStore.closeUsageSessions(projectId);
    const running = observedState === "ready" || observedState === "starting";
    return {
      projectId,
      canOperate: permission?.canOperate ?? false,
      preferredProfile,
      sandbox: {
        name: runtime.serverName,
        state: observedState,
        url: server?.ready ? sandboxUrl(hub.hubPublicUrl, runtime.hubUsername, runtime.serverName) : null,
        // The instance type of the running server; null when stopped, so the UI falls back to the preference.
        profile: running ? runtime.profile : null,
      },
    };
  } catch (error) {
    if (handleHubIdentityError(reply, error)) return;
    request.log.error({ err: error }, "Project sandbox read failed");
    return handleHubError(reply, error);
  }
});

// Sandbox profiles offered to Projects. GPU profiles appear only when the deployment enables them.
const sandboxGpuProfiles = process.env.SANDBOX_GPU_PROFILES === "true";

app.get<{ Params: { projectId: string } }>("/v1/projects/:projectId/sandbox/profiles", async (request, reply) => {
  const session = await requireSession(request, reply);
  if (!session) return;
  if (!appStore) return reply.code(503).send({ error: "APP_DATABASE_UNAVAILABLE", message: "Project storage is not configured." });
  try {
    if (!(await projectActionAllowed(reply, session.subject, request.params.projectId, "read"))) return;
    // Profiles the Space's plan cannot run are listed as unavailable, so the UI does not offer a start that will be refused.
    const spacePlan = await appStore.spaceAndPlanForProject(request.params.projectId);
    const plan = getMockPlan(spacePlan?.planId ?? FREE_PLAN_ID) ?? getMockPlan(FREE_PLAN_ID)!;
    const profiles = listSandboxProfiles(sandboxGpuProfiles).map((profile) => ({
      ...profile,
      available: profile.available && planAllowsRuntime(plan, runtimeClassForProfile(profile.kind)) === null,
    }));
    return { projectId: request.params.projectId, profiles };
  } catch (error) {
    request.log.error({ err: error }, "Sandbox profile list failed");
    return reply.code(503).send({ error: "APP_DATABASE_UNAVAILABLE", message: "Project storage is temporarily unavailable." });
  }
});

app.post<{ Params: { projectId: string }; Body: { profile?: unknown } | undefined }>("/v1/projects/:projectId/sandbox/start", async (request, reply) => {
  if (!requireCsrf(request, reply)) return;
  const session = await requireSession(request, reply);
  if (!session) return;
  if (!appStore) return reply.code(503).send({ error: "APP_DATABASE_UNAVAILABLE", message: "Project storage is not configured." });
  const { projectId } = request.params;
  // An explicit profile must be valid. Without one, the Project's last started profile is used (see below).
  const requested = request.body?.profile;
  if (requested !== undefined) {
    const check = resolveSandboxProfile(requested, sandboxGpuProfiles);
    if (!check.ok) return reply.code(400).send({ error: check.error, message: "Cấu hình sandbox không hợp lệ hoặc chưa được bật." });
  }
  try {
    if (!(await projectActionAllowed(reply, session.subject, projectId, "operate"))) return;
    // Persist this user's Hub identity before creating the runtime row. Otherwise a first sign-in that starts
    // a Project right away (without visiting Usage/Quota first) gets PROJECT_OWNER_NOT_READY.
    await persistSessionHubIdentity(await resolveSessionHubIdentity(session));
    let runtime;
    try {
      runtime = await appStore.ensureProjectSandboxRuntime(projectId);
    } catch (error) {
      if (error instanceof Error && error.message === PROJECT_RUNTIME_OWNER_NOT_READY) {
        return reply.code(409).send({ error: "PROJECT_OWNER_NOT_READY", message: "Chủ Project cần đăng nhập dashboard một lần để khởi tạo runtime." });
      }
      throw error;
    }
    // No requested profile: launch the Project's last started profile. A Project that has never started
    // (or whose profile is no longer offered) gets the default, the smallest CPU profile, which the free tier allows.
    let resolved = resolveSandboxProfile(requested === undefined ? (runtime.profile ?? undefined) : requested, sandboxGpuProfiles);
    if (!resolved.ok && requested === undefined) resolved = resolveSandboxProfile(undefined, sandboxGpuProfiles);
    if (!resolved.ok) return reply.code(400).send({ error: resolved.error, message: "Cấu hình sandbox không hợp lệ hoặc chưa được bật." });
    const hub = runtimeConfig();
    const username = runtime.hubUsername;
    const existing = await readHubServer(hub, username, runtime.serverName).catch((error) => {
      if (hubStatus(error) === 404) return null;
      throw error;
    });
    if (!shouldStartHubSandbox(existing)) {
      return { ok: true, projectId, state: mapHubServerState(existing) };
    }
    // Plan gate: GPU profiles need a GPU-enabled plan, and a Space that has used its monthly compute units cannot start more runtimes.
    const spacePlan = await appStore.spaceAndPlanForProject(projectId);
    if (!spacePlan) return reply.code(404).send({ error: "NOT_FOUND", message: "Project không tồn tại." });
    const plan = getMockPlan(spacePlan.planId ?? FREE_PLAN_ID) ?? getMockPlan(FREE_PLAN_ID)!;
    const runtimeClass = runtimeClassForProfile(resolved.profile.kind);
    // Sessions left open by a crashed runtime are closed at the cap before the balance is read.
    await appStore.closeStaleUsageSessions(spacePlan.spaceId, MAX_USAGE_SESSION_HOURS);
    const unitsUsed = plan.credits === null ? 0 : await appStore.creditsUsedThisMonth(spacePlan.spaceId);
    const access = runtimeAccessDecision(plan, runtimeClass, unitsUsed);
    if (!access.allowed) {
      if (access.code === "CREDITS_EXHAUSTED") {
        return reply.code(429).send({ error: "QUOTA_EXCEEDED", metric: "credits", limit: plan.credits, current: unitsUsed, enforcement: "enforced" });
      }
      return reply.code(403).send({ error: access.code, message: "Profile này cần gói trả phí. Hãy nâng cấp gói để dùng." });
    }
    // Projects are kept without a count limit; the plan limits how many sandboxes run at the same time.
    const runningNow = await appStore.openUsageSessionCount(spacePlan.spaceId);
    if (plan.concurrentSandboxes !== null && runningNow >= plan.concurrentSandboxes) {
      return reply.code(429).send({ error: "QUOTA_EXCEEDED", metric: "concurrent_sandboxes", limit: plan.concurrentSandboxes, current: runningNow, enforcement: "enforced", message: "Gói đã đạt số sandbox chạy đồng thời tối đa. Dừng một sandbox hoặc nâng gói." });
    }
    // RAM quota: the Hub user's other servers count, and the chosen profile's RAM is the request.
    // A 404 means the Hub user was never created (the Hub record and the BFF's identity can disagree), so
    // the start must provision the user first. Hard-coding "exists" made every start fail with 404.
    let hubUserExists = true;
    const hubUser = await hubRequest<HubUser>(hub, "GET", `/hub/api/users/${usernamePath(username)}`).catch((error) => {
      if (hubStatus(error) === 404) {
        hubUserExists = false;
        return { servers: {} } as HubUser;
      }
      throw error;
    });
    const otherServers = (Object.entries(hubUser.servers ?? {}) as Array<[string, HubServer]>)
      .filter(([key, server]) => (server.name || key || "default") !== runtime.serverName)
      .map(([key, server]) => usageServer(key, server));
    const quota = checkRamQuota(otherServers, hub.ramQuotaGb, resolved.profile.ramGb);
    if (!quota.allowed) {
      return reply.code(429).send({
        error: "QUOTA_EXCEEDED",
        metric: "ram",
        limit: quota.limitGb,
        current: quota.currentGb,
        requested: quota.requestedGb,
        enforcement: quota.enforcement,
      });
    }
    const lifecycle = await resolveStartLifecycle({
      start: () => startHubSandbox({
        userExists: hubUserExists,
        ensureUser: async () => {
          await ensureRuntimeHubUser(hub, username);
        },
        onRetry: () => auditLifecycle(session, "project.sandbox_start_retry", projectId, { status: 404 }),
        // JupyterHub takes the spawn options in the body; `profile` selects the Hub profile by slug.
        start: () => hubRequestResponse<HubServerLike>(hub, "POST", serverPath(username, runtime.serverName), { profile: resolved.profile.slug }),
      }),
      read: async () => readHubServer(hub, username, runtime.serverName),
      audit: (action, metadata) => auditLifecycle(session, action, projectId, metadata),
    });
    if (lifecycle.state === "ready" || lifecycle.state === "starting") {
      await appStore.openUsageSession(projectId, session.subject, creditsPerHourForRuntime(runtimeClass));
      // The started profile is remembered for the Project and as the user's default for the next start.
      await appStore.setSandboxProfile(projectId, resolved.profile.slug);
    }
    return { ok: true, projectId, state: lifecycle.state };
  } catch (error) {
    if (handleHubIdentityError(reply, error)) return;
    request.log.error({ err: error }, "Project sandbox start failed");
    return handleHubError(reply, error);
  }
});

app.post<{ Params: { projectId: string } }>("/v1/projects/:projectId/sandbox/stop", async (request, reply) => {
  if (!requireCsrf(request, reply)) return;
  const session = await requireSession(request, reply);
  if (!session) return;
  if (!appStore) return reply.code(503).send({ error: "APP_DATABASE_UNAVAILABLE", message: "Project storage is not configured." });
  const { projectId } = request.params;
  try {
    if (!(await projectActionAllowed(reply, session.subject, projectId, "operate"))) return;
    const runtime = await appStore.getProjectSandboxRuntime(projectId);
    if (!runtime) return reply.code(404).send({ error: "NOT_FOUND", message: "Project chưa có Sandbox." });
    const hub = runtimeConfig();
    const stopped = await hubRequestResponse<HubServerLike>(hub, "DELETE", serverPath(runtime.hubUsername, runtime.serverName));
    await auditLifecycle(session, "project.sandbox_stopped", projectId, { status: stopped.status });
    await appStore.closeUsageSessions(projectId);
    return { ok: true, projectId, state: "stopped" };
  } catch (error) {
    if (handleHubIdentityError(reply, error)) return;
    request.log.error({ err: error }, "Project sandbox stop failed");
    return handleHubError(reply, error);
  }
});

// Artifacts (phase 5 MVP): metadata in Postgres, bytes in the workspace bucket under the Project prefix.
// Upload is two-step: create (presigned PUT URL) then complete (HEAD check) before it becomes ready.
const workspaceBucket = process.env.WORKSPACE_BUCKET;
const artifactStorage = workspaceBucket ? new ArtifactStorage(workspaceBucket) : null;

const GIB = 1024 * 1024 * 1024;

type ArtifactPolicy = { retentionDays: number; storageGb: number | null };

// The Space's plan decides how long artifacts are kept and how much storage the Space may use.
async function artifactPolicy(store: AppStore, spaceId: string): Promise<ArtifactPolicy> {
  return artifactPolicyForPlan(await store.activePlanIdForSpace(spaceId));
}

// Deletes artifacts older than the plan's retention. Runs on read and before uploads, so there is no
// separate scheduler: an expired file is removed the next time its Project is opened.
async function sweepExpiredArtifacts(store: AppStore, storage: ArtifactStorage, projectId: string, retentionDays: number): Promise<void> {
  const cutoff = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000);
  const expired = await store.listArtifactsCreatedBefore(projectId, cutoff);
  if (expired.length === 0) return;
  for (const artifact of expired) await storage.deleteObject(artifact.objectKey);
  await store.deleteArtifactRows(projectId, expired.map((artifact) => artifact.id));
}

async function artifactSettingsFor(store: AppStore, projectId: string, spaceId: string, policy: ArtifactPolicy) {
  const enabled = await store.getProjectArtifactsEnabled(projectId);
  const usage = await store.artifactUsageForSpace(spaceId, projectId);
  return {
    enabled,
    retentionDays: policy.retentionDays,
    storage: {
      quotaGb: policy.storageGb,
      projectBytes: usage.projectBytes,
      otherProjectBytes: usage.otherProjectBytes,
    },
  };
}

app.get<{ Params: { projectId: string } }>("/v1/projects/:projectId/artifacts", async (request, reply) => {
  const session = await requireSession(request, reply);
  if (!session) return;
  if (!appStore) return reply.code(503).send({ error: "APP_DATABASE_UNAVAILABLE", message: "Project storage is not configured." });
  try {
    const projectId = request.params.projectId;
    if (!(await projectActionAllowed(reply, session.subject, projectId, "read"))) return;
    const permission = await appStore.projectPermission(session.subject, projectId);
    const spaceId = await appStore.getProjectSpaceId(projectId);
    if (!spaceId) return reply.code(404).send({ error: "NOT_FOUND", message: "Project không tồn tại." });
    const policy = await artifactPolicy(appStore, spaceId);
    if (artifactStorage) await sweepExpiredArtifacts(appStore, artifactStorage, projectId, policy.retentionDays);
    return {
      projectId,
      canOperate: permission?.canOperate ?? false,
      settings: await artifactSettingsFor(appStore, projectId, spaceId, policy),
      artifacts: await appStore.listArtifacts(projectId),
    };
  } catch (error) {
    request.log.error({ err: error }, "Artifact list failed");
    return reply.code(503).send({ error: "APP_DATABASE_UNAVAILABLE", message: "Artifact storage is temporarily unavailable." });
  }
});

app.post<{ Params: { projectId: string }; Body: { name?: string; contentType?: string; sizeBytes?: number } }>(
  "/v1/projects/:projectId/artifacts",
  async (request, reply) => {
    if (!requireCsrf(request, reply)) return;
    const session = await requireSession(request, reply);
    if (!session) return;
    if (!appStore || !artifactStorage) return reply.code(503).send({ error: "ARTIFACTS_NOT_CONFIGURED", message: "Artifact storage is not configured." });
    const projectId = request.params.projectId;
    try {
      if (!(await projectActionAllowed(reply, session.subject, projectId, "operate"))) return;
      const name = sanitizeArtifactName(request.body?.name ?? "");
      const sizeBytes = validateArtifactSize(request.body?.sizeBytes);
      if (!name || sizeBytes === null) return reply.code(400).send({ error: "INVALID_INPUT", message: "Tên file hoặc kích thước không hợp lệ." });
      const contentType = typeof request.body?.contentType === "string" && /^[\w.+-]+\/[\w.+-]+$/.test(request.body.contentType)
        ? request.body.contentType
        : "application/octet-stream";
      const spaceId = await appStore.getProjectSpaceId(projectId);
      if (!spaceId) return reply.code(404).send({ error: "NOT_FOUND", message: "Project không tồn tại." });
      if (!(await appStore.getProjectArtifactsEnabled(projectId))) {
        return reply.code(409).send({ error: "ARTIFACTS_DISABLED", message: "Lưu trữ artifacts đang tắt. Bật lại trong trang Project để tải lên." });
      }
      const policy = await artifactPolicy(appStore, spaceId);
      if (policy.storageGb !== null) {
        const usage = await appStore.artifactUsageForSpace(spaceId, projectId);
        const usedBytes = usage.projectBytes + usage.otherProjectBytes;
        if (usedBytes + sizeBytes > policy.storageGb * GIB) {
          return reply.code(429).send({
            error: "QUOTA_EXCEEDED",
            metric: "storage",
            limit: policy.storageGb,
            current: usedBytes / GIB,
            requested: sizeBytes / GIB,
            message: "Đã vượt hạn mức lưu trữ của gói. Xóa bớt artifact hoặc nâng gói để tải thêm.",
          });
        }
      }
      const artifactId = randomUUID();
      const objectKey = buildArtifactObjectKey(spaceId, projectId, artifactId, name);
      const artifact = await appStore.createArtifact({ id: artifactId, projectId, name, objectKey, contentType, sizeBytes, createdBy: session.subject });
      const uploadUrl = await artifactStorage.presignUpload(objectKey, contentType, sizeBytes);
      return reply.code(201).send({ artifact, upload: { url: uploadUrl, method: "PUT", headers: { "content-type": contentType } } });
    } catch (error) {
      request.log.error({ err: error }, "Artifact create failed");
      return reply.code(503).send({ error: "APP_DATABASE_UNAVAILABLE", message: "Artifact storage is temporarily unavailable." });
    }
  },
);

// Turning storage off deletes every stored artifact of the Project. Without confirmDeleteAll the
// server answers 409 with the count, so the browser must ask the user first.
app.put<{ Params: { projectId: string }; Body: { enabled?: unknown; confirmDeleteAll?: unknown } | undefined }>("/v1/projects/:projectId/artifacts/settings", async (request, reply) => {
  if (!requireCsrf(request, reply)) return;
  const session = await requireSession(request, reply);
  if (!session) return;
  if (!appStore || !artifactStorage) return reply.code(503).send({ error: "ARTIFACTS_NOT_CONFIGURED", message: "Artifact storage is not configured." });
  const projectId = request.params.projectId;
  const enabled = request.body?.enabled;
  if (typeof enabled !== "boolean") return reply.code(400).send({ error: "INVALID_INPUT", message: "Thiếu trạng thái bật/tắt lưu trữ." });
  try {
    if (!(await projectActionAllowed(reply, session.subject, projectId, "operate"))) return;
    if (enabled) {
      await appStore.setProjectArtifactsEnabled(projectId, true);
      return { ok: true, enabled: true, deleted: 0 };
    }
    const stored = await appStore.listArtifacts(projectId);
    if (stored.length > 0 && request.body?.confirmDeleteAll !== true) {
      return reply.code(409).send({
        error: "CONFIRMATION_REQUIRED",
        count: stored.length,
        message: "Tắt lưu trữ sẽ xóa toàn bộ artifact của Project. Xác nhận để tiếp tục.",
      });
    }
    // Rows go only after their object is gone. If a delete fails midway, the rest stay listed and can be retried.
    const deletedIds: string[] = [];
    for (const artifact of stored) {
      await artifactStorage.deleteObject(artifact.objectKey);
      deletedIds.push(artifact.id);
    }
    await appStore.deleteArtifactRows(projectId, deletedIds);
    if (deletedIds.length === stored.length) await appStore.setProjectArtifactsEnabled(projectId, false);
    return { ok: deletedIds.length === stored.length, enabled: deletedIds.length !== stored.length, deleted: deletedIds.length };
  } catch (error) {
    request.log.error({ err: error }, "Artifact storage setting update failed");
    return reply.code(503).send({ error: "APP_DATABASE_UNAVAILABLE", message: "Artifact storage is temporarily unavailable." });
  }
});

app.post<{ Params: { projectId: string; artifactId: string } }>("/v1/projects/:projectId/artifacts/:artifactId/complete", async (request, reply) => {
  if (!requireCsrf(request, reply)) return;
  const session = await requireSession(request, reply);
  if (!session) return;
  if (!appStore || !artifactStorage) return reply.code(503).send({ error: "ARTIFACTS_NOT_CONFIGURED", message: "Artifact storage is not configured." });
  const { projectId, artifactId } = request.params;
  try {
    if (!(await projectActionAllowed(reply, session.subject, projectId, "operate"))) return;
    const artifact = await appStore.getArtifact(projectId, artifactId);
    if (!artifact) return reply.code(404).send({ error: "NOT_FOUND", message: "Artifact không tồn tại." });
    if (artifact.status === "ready") return { ok: true, artifact };
    const stored = await artifactStorage.headObjectSize(artifact.objectKey);
    if (stored !== artifact.sizeBytes) {
      return reply.code(409).send({ error: "UPLOAD_INCOMPLETE", message: "File chưa được tải lên đầy đủ." });
    }
    await appStore.markArtifactReady(projectId, artifactId);
    return { ok: true, artifact: { ...artifact, status: "ready" } };
  } catch (error) {
    request.log.error({ err: error }, "Artifact completion failed");
    return reply.code(503).send({ error: "APP_DATABASE_UNAVAILABLE", message: "Artifact storage is temporarily unavailable." });
  }
});

app.get<{ Params: { projectId: string; artifactId: string } }>("/v1/projects/:projectId/artifacts/:artifactId/download", async (request, reply) => {
  const session = await requireSession(request, reply);
  if (!session) return;
  if (!appStore || !artifactStorage) return reply.code(503).send({ error: "ARTIFACTS_NOT_CONFIGURED", message: "Artifact storage is not configured." });
  const { projectId, artifactId } = request.params;
  try {
    if (!(await projectActionAllowed(reply, session.subject, projectId, "read"))) return;
    const artifact = await appStore.getArtifact(projectId, artifactId);
    if (!artifact || artifact.status !== "ready") return reply.code(404).send({ error: "NOT_FOUND", message: "Artifact không tồn tại." });
    return { artifact: { id: artifact.id, name: artifact.name }, url: await artifactStorage.presignDownload(artifact.objectKey, artifact.name) };
  } catch (error) {
    request.log.error({ err: error }, "Artifact download failed");
    return reply.code(503).send({ error: "APP_DATABASE_UNAVAILABLE", message: "Artifact storage is temporarily unavailable." });
  }
});

app.get("/v1/sandboxes", async (request, reply) => {
  const session = await requireSession(request, reply);
  if (!session) return;
  const runtime = runtimeConfig();
  try {
    const identity = await resolveSessionHubIdentity(session);
    await persistSessionHubIdentity(identity);
    const hubUsername = identity.hubUsername;
    let hubUserExists = true;
    try {
      await ensureRuntimeHubUser(runtime, hubUsername);
    } catch (error) {
      if (hubStatus(error) === 404) hubUserExists = false;
      else throw error;
    }
    if (appStore) {
      const user = await hubRequest<HubUser>(runtime, "GET", `/hub/api/users/${usernamePath(hubUsername)}`).catch((error) => {
        if (hubStatus(error) === 404) {
          hubUserExists = false;
          return { servers: {} };
        }
        throw error;
      });
      const sandboxes = [];
      const names = (Object.entries(user.servers ?? {}) as Array<[string, HubServer]>).map(([key, server]) => server.name || key || "default");
      await appStore.importSandboxMappings(session.subject, session.email, names, hubUsername);
      for (const [key, server] of Object.entries(user.servers ?? {}) as Array<[string, HubServer]>) {
        const name = server.name || key || "default";
        if (!(await appStore.authorizeSandbox(session.subject, session.email, name, "read"))) continue;
        sandboxes.push({
          name,
          state: mapHubServerState(server),
          url: server.ready && /^(default|[a-z0-9][a-z0-9-]{0,62})$/i.test(name) ? sandboxUrl(runtime.hubPublicUrl, hubUsername, name) : null,
          lastActivity: server.last_activity ?? null,
        });
      }
      return { user: { email: session.email }, hub: hubActivationState(runtime.hubPublicUrl, hubUserExists), sandboxes };
    }
    const user = await hubRequest<HubUser>(runtime, "GET", `/hub/api/users/${usernamePath(hubUsername)}`);
    const servers = Object.entries(user.servers ?? {}).map(([key, server]) => ({
      name: server.name || key || "default",
      state: mapHubServerState(server),
      // Build the destination from trusted configuration and session identity;
      // never turn a Hub-provided URL into a user-facing link.
      url: server.ready && /^(default|[a-z0-9][a-z0-9-]{0,62})$/i.test(server.name || key)
        ? sandboxUrl(runtime.hubPublicUrl, hubUsername, server.name || key)
        : null,
      lastActivity: server.last_activity ?? null,
    }));
    return { user: { email: session.email }, hub: hubActivationState(runtime.hubPublicUrl, true), sandboxes: servers };
  } catch (error) {
    if (handleHubIdentityError(reply, error)) return;
    // A user unknown to the Hub (never spawned a server) has an empty list, not an error.
    if (hubStatus(error) === 404) {
      return { user: { email: session.email }, hub: hubActivationState(runtime.hubPublicUrl, false), sandboxes: [] };
    }
    request.log.error({ err: error }, "JupyterHub sandbox list failed");
    return handleHubError(reply, error);
  }
});

app.get("/v1/usage", async (request, reply) => {
  const session = await requireSession(request, reply);
  if (!session) return;
  try {
    const identity = await resolveSessionHubIdentity(session);
    await persistSessionHubIdentity(identity);
    const hubUsername = identity.hubUsername;
    const runtime = runtimeConfig();
    const quotas = {
      cpuHours: runtime.cpuQuotaHours,
      ramGb: runtime.ramQuotaGb,
      storageGb: runtime.storageQuotaGb,
      gpuHours: runtime.gpuQuotaHours,
    };
    let user: HubUser;
    try {
      user = await hubRequest<HubUser>(runtime, "GET", `/hub/api/users/${usernamePath(hubUsername)}`);
    } catch (error) {
      // A user unknown to the Hub (never spawned a server) has an empty footprint, not an error.
      if (hubStatus(error) === 404) return buildUsageResponse([], quotas);
      throw error;
    }
    const servers = Object.entries(user.servers ?? {}).map(([key, server]) => usageServer(key, server));
    await fillPodResources(servers, hubUsername, request.log);
    const result = buildUsageResponse(servers, quotas);
    if (appStore) {
      // Compute units are a Space pool; the personal Space is the one this account's runtimes bill to.
      const spaceId = `personal:${session.subject}`;
      await appStore.closeStaleUsageSessions(spaceId, MAX_USAGE_SESSION_HOURS);
      const planId = await appStore.activePlanIdForSpace(spaceId);
      const plan = getMockPlan(planId ?? FREE_PLAN_ID) ?? getMockPlan(FREE_PLAN_ID)!;
      result.credits = { planId: plan.id, limit: plan.credits, used: await appStore.creditsUsedThisMonth(spaceId) };
      // Storage is measured from artifact bytes in the Space against the plan's storage limit.
      const stored = await appStore.artifactUsageForSpace(spaceId, "");
      result.quota.storageGb = {
        limit: plan.storageGb ?? 0,
        unit: "GB",
        usage: (stored.projectBytes + stored.otherProjectBytes) / GIB,
        tracking: "measured",
      };
      result.concurrentSandboxes = { limit: plan.concurrentSandboxes, running: await appStore.openUsageSessionCount(spaceId) };
      // Each usage session with the credits it used, for the detailed list.
      result.creditSessions = (await appStore.creditSessions(spaceId, 30, 200)).map((session) => ({
        id: session.id,
        projectName: session.projectName,
        startedAt: session.startedAt.toISOString(),
        endedAt: session.endedAt ? session.endedAt.toISOString() : null,
        hours: session.hours,
        credits: session.credits,
      }));
      // Storage per Project, so the user can see which Project holds how much.
      result.storageByProject = (await appStore.storageByProject(spaceId)).map((project) => ({
        projectId: project.projectId,
        name: project.name,
        storageGb: project.bytes / GIB,
      }));
      // Last 30 days, one point per day: credits used that day, and storage held at the end of that day.
      const storageDays = await appStore.storageHistory(spaceId, 30);
      result.resourceHistory = {
        days: 30,
        credits: await appStore.creditHistory(spaceId, 30),
        storage: storageDays.map((day) => ({ date: day.date, storageGb: day.bytes / GIB })),
      };
    }
    if (usageStore) {
      try {
        usageSchemaReady ??= usageStore.ensureSchema();
        await usageSchemaReady;
        await usageStore.sample(hubUsername, { runningServers: result.footprint.runningServers, cpuCoresAllocated: result.footprint.cpuCoresAllocated, ramGbAllocated: result.footprint.ramGbAllocated });
        result.history = await usageStore.history(hubUsername, 168);
        result.historyAvailable = true;
      } catch (error) {
        usageSchemaReady = null;
        request.log.warn({ err: error instanceof Error ? error.name : "database_error" }, "Usage history unavailable");
        result.history = [];
        result.historyAvailable = false;
      }
    } else {
      result.history = [];
      result.historyAvailable = false;
    }
    return result;
  } catch (error) {
    if (handleHubIdentityError(reply, error)) return;
    request.log.error({ err: error }, "JupyterHub usage query failed");
    return handleHubError(reply, error);
  }
});

app.get("/v1/usage/history", async (request, reply) => {
  const session = await requireSession(request, reply);
  if (!session) return;
  if (!usageStore) return { available: false, samples: [] };
  try {
    const identity = await resolveSessionHubIdentity(session);
    await persistSessionHubIdentity(identity);
    usageSchemaReady ??= usageStore.ensureSchema();
    await usageSchemaReady;
    return { available: true, samples: await usageStore.history(identity.hubUsername, 168) };
  } catch (error) {
    if (handleHubIdentityError(reply, error)) return;
    usageSchemaReady = null;
    request.log.warn({ err: error instanceof Error ? error.name : "database_error" }, "Usage history query unavailable");
    return { available: false, samples: [] };
  }
});

app.post<{ Params: { name: string } }>("/v1/sandboxes/:name/start", async (request, reply) => {
  if (!requireCsrf(request, reply)) return;
  const session = await requireSession(request, reply);
  if (!session) return;
  let enforcement: "enforced" | "degraded" = "enforced";
  const runtime = runtimeConfig();
  let hubUserExists = true;
  try {
    const identity = await resolveSessionHubIdentity(session);
    const hubUsername = identity.hubUsername;
    let user: HubUser;
    try {
      user = await hubRequest<HubUser>(runtime, "GET", `/hub/api/users/${usernamePath(hubUsername)}`);
    } catch (error) {
      if (hubStatus(error) !== 404) throw error;
      hubUserExists = false;
      user = { servers: {} };
    }
    const currentEntries = Object.entries(user.servers ?? {}) as Array<[string, HubServer]>;
    if (appStore && !(await appStore.authorizeSandbox(session.subject, session.email, request.params.name, "operate"))) {
      const alreadyExists = currentEntries.some(([key, server]) => (server.name || key || "default") === request.params.name);
      if (alreadyExists) {
        return reply.code(403).send({ error: "FORBIDDEN", message: "Bạn không có quyền vận hành Sandbox này." });
      }
      await appStore.ensureSandboxProject(session.subject, session.email, request.params.name, hubUsername);
    }
    const currentServers = currentEntries.map(([key, server]) => usageServer(key, server));
    try {
      const quota = checkRamQuota(currentServers, runtime.ramQuotaGb);
      if (!quota.allowed) {
        reply.code(429).send({
          error: "QUOTA_EXCEEDED",
          metric: "ram",
          limit: quota.limitGb,
          current: quota.currentGb,
          requested: quota.requestedGb,
          enforcement: quota.enforcement,
        });
        return;
      }
      enforcement = quota.enforcement;
      if (enforcement === "degraded") {
        request.log.warn({ username: hubUsername }, "RAM quota check degraded; allowing sandbox start");
      }
    } catch (error) {
      enforcement = "degraded";
      request.log.warn({ err: error instanceof Error ? error.name : "hub_error", username: hubUsername }, "RAM quota check unavailable; allowing sandbox start");
    }
    await persistSessionHubIdentity(identity);
    const existingServer = currentEntries.find(([key, server]) => (server.name || key || "default") === request.params.name)?.[1] ?? null;
    if (!shouldStartHubSandbox(existingServer)) {
      return { ok: true, name: request.params.name, state: mapHubServerState(existingServer), enforcement };
    }
    const lifecycle = await resolveStartLifecycle({
      start: () => startHubSandbox({
        userExists: hubUserExists,
        ensureUser: async () => {
          await ensureRuntimeHubUser(runtime, hubUsername);
          hubUserExists = true;
        },
        onRetry: () => auditLifecycle(session, "sandbox.start_retry", request.params.name, { status: 404 }),
        start: () => hubRequestResponse<HubServerLike>(runtime, "POST", serverPath(hubUsername, request.params.name), {}),
      }),
      read: async () => readHubServer(runtime, hubUsername, request.params.name),
      audit: (action, metadata) => auditLifecycle(session, action, request.params.name, metadata),
    });
    return { ok: true, name: request.params.name, state: lifecycle.state, enforcement };
  } catch (error) {
    request.log.error({ err: error }, "JupyterHub sandbox start failed");
    if (handleHubIdentityError(reply, error)) return;
    if (shouldUseHubActivationFallback(hubUserExists, error)) {
      reply.code(409).send({ error: "HUB_USER_UNKNOWN", activationUrl: hubActivationUrl(runtime.hubPublicUrl), message: "Workspace của bạn đang được chuẩn bị. Vui lòng thử lại sau ít phút." });
      return;
    }
    return handleHubError(reply, error);
  }
});

app.delete<{ Params: { name: string } }>("/v1/sandboxes/:name", async (request, reply) => {
  if (!requireCsrf(request, reply)) return;
  const session = await requireSession(request, reply);
  if (!session) return;
  try {
    const runtime = runtimeConfig();
    const identity = await resolveSessionHubIdentity(session);
    const hubUsername = identity.hubUsername;
    if (appStore && !(await appStore.authorizeSandbox(session.subject, session.email, request.params.name, "operate"))) {
      return reply.code(403).send({ error: "FORBIDDEN", message: "Bạn không có quyền vận hành Sandbox này." });
    }
    await persistSessionHubIdentity(identity);
    const stopped = await hubRequestResponse<HubServerLike>(runtime, "DELETE", serverPath(hubUsername, request.params.name));
    await auditLifecycle(session, "sandbox.stopped", request.params.name, { status: stopped.status });
    return { ok: true, name: request.params.name, state: "stopped" };
  } catch (error) {
    if (handleHubIdentityError(reply, error)) return;
    request.log.error({ err: error }, "JupyterHub sandbox stop failed");
    return handleHubError(reply, error);
  }
});

app.listen({ port: config.port, host: config.host }).catch((error) => {
  app.log.error(error);
  process.exit(1);
});
