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
  ResendConfirmationCodeCommand,
  SignUpCommand,
} from "@aws-sdk/client-cognito-identity-provider";
import { DeleteItemCommand, DynamoDBClient, GetItemCommand, PutItemCommand } from "@aws-sdk/client-dynamodb";
import cookie from "@fastify/cookie";
import Fastify, { type FastifyReply, type FastifyRequest } from "fastify";
import { createHash, createSecretKey, randomBytes, randomUUID } from "node:crypto";
import { validCsrfPair } from "./csrf.js";
import { ensureHubUser, hubActivationState, hubActivationUrl, hubFailure, mapHubServerState, sandboxPath, sandboxUrl, startHubSandbox, type HubError, type HubRequestResponse, type HubLifecycleState, type HubServerLike } from "./hub.js";
import { requestHubResponse, resolveStartLifecycle, shouldStartHubSandbox, shouldUseHubActivationFallback } from "./lifecycle.js";
import {
  buildUsageResponse,
  checkRamQuota,
  parseCpuCores,
  parseMemoryGb,
  type UsageServer,
} from "./usage.js";
import { UsageStore } from "./usage-store.js";
import { AppStore } from "./app-store.js";
import { verifyTurnstile } from "./turnstile.js";
import {
  HubIdentityConflictError,
  persistResolvedHubIdentity,
  resolveAuthenticatedHubIdentity,
  type HubIdentityStore,
} from "./hub-identity-routing.js";
import type { HubIdentity } from "./hub-identity.js";
import {
  getMockPlan,
  isMockPaymentMethod,
  isMockPaymentOutcome,
  listMockPlans,
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

async function ensureAppBootstrap(session: Session): Promise<void> {
  if (!appStore) return;
  appSchemaReady ??= appStore.ensureSchema();
  try {
    await appSchemaReady;
    await appStore.ensureUserBootstrap(session.subject, session.email);
  } catch (error) {
    appSchemaReady = null;
    throw new Error("Application database unavailable", { cause: error });
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

function serverPath(username: string, name: string): string {
  return sandboxPath(username, name);
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
  requireCsrf(request, reply);
});

app.get("/v1/health", async (_request, reply) => {
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

app.get("/v1/auth/csrf", async (_request, reply) => {
  reply.header("cache-control", "no-store");
  return { csrfToken: setCsrfCookie(reply, config.secureCookies) };
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
    const refreshToken = result.AuthenticationResult.RefreshToken;
    if (refreshToken) await saveRefreshToken(runtime, session.sessionId, refreshToken);
    await setSessionCookie(reply, runtime, session);
    setCsrfCookie(reply, runtime.secureCookies);
    return { user: { email: session.email } };
  } catch (error) {
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
  return { ok: true };
});

app.get<{ Querystring: { spaceId?: string } }>("/v1/projects", async (request, reply) => {
  const session = await requireSession(request, reply);
  if (!session) return;
  if (!appStore) return reply.code(503).send({ error: "APP_DATABASE_UNAVAILABLE", message: "Project storage is not configured." });
  const spaceId = requiredString(request.query.spaceId) ?? `personal:${session.subject}`;
  try {
    return { spaceId, projects: await appStore.listProjects(session.subject, spaceId) };
  } catch (error) {
    request.log.error({ err: error }, "Project list failed");
    return reply.code(503).send({ error: "APP_DATABASE_UNAVAILABLE", message: "Project storage is temporarily unavailable." });
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

app.post<{ Body: CheckoutBody }>("/v1/subscriptions/mock/checkout", async (request, reply) => {
  if (!requireCsrf(request, reply)) return;
  const session = await requireSession(request, reply);
  if (!session) return;
  if (!appStore) return reply.code(503).send({ error: "APP_DATABASE_UNAVAILABLE", message: "Subscription storage is not configured." });
  const spaceId = requiredString(request.body?.spaceId) ?? `personal:${session.subject}`;
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
    return reply.code(201).send({ project: await appStore.createProject(session.subject, spaceId, teamId, name) });
  } catch (error) {
    if (error instanceof Error && error.message === "Project team access denied") {
      return reply.code(403).send({ error: "FORBIDDEN", message: "Bạn không có quyền tạo Project trong Space này." });
    }
    request.log.error({ err: error }, "Project creation failed");
    return reply.code(503).send({ error: "APP_DATABASE_UNAVAILABLE", message: "Project storage is temporarily unavailable." });
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
    const result = buildUsageResponse(servers, quotas);
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
      read: async () => hubRequest<HubServerLike>(runtime, "GET", serverPath(hubUsername, request.params.name)),
      audit: (action, metadata) => auditLifecycle(session, action, request.params.name, metadata),
    });
    return { ok: true, name: request.params.name, state: lifecycle.state, enforcement };
  } catch (error) {
    request.log.error({ err: error }, "JupyterHub sandbox start failed");
    if (handleHubIdentityError(reply, error)) return;
    if (shouldUseHubActivationFallback(hubUserExists, error)) {
      reply.code(409).send({ error: "HUB_USER_UNKNOWN", activationUrl: hubActivationUrl(runtime.hubPublicUrl), message: "Tài khoản chưa được kích hoạt trên Hub. Đăng nhập vào notebook hub một lần để kích hoạt." });
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
