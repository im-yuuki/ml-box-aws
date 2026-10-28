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
import { hubFailure, sandboxPath, sandboxUrl, type HubError } from "./hub.js";
import {
  buildUsageResponse,
  checkRamQuota,
  parseCpuCores,
  parseMemoryGb,
  type UsageServer,
} from "./usage.js";
import { UsageStore } from "./usage-store.js";
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
};

type RuntimeConfig = typeof config & {
  userPoolId: string;
  clientId: string;
  sessionSecret: string;
  sessionsTable: string;
  hubUrl: string;
  hubPublicUrl: string;
  hubApiToken: string;
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
};

type AuthBody = {
  email?: string;
  password?: string;
  currentPassword?: string;
  newPassword?: string;
};

type ConfirmBody = AuthBody & { code?: string };
type ResetBody = AuthBody & { code?: string; confirmationCode?: string; newPassword?: string };

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
let usageSchemaReady: Promise<void> | null = null;
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
    typeof parsed.expiresAt !== "number"
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
  try {
    return await sessionFromRequest(request);
  } catch {
    reply.code(401).send({ error: "UNAUTHENTICATED", message: "Phiên đăng nhập đã hết hạn." });
    return null;
  }
}

function usernamePath(username: string): string {
  return encodeURIComponent(username);
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

async function hubRequest<T>(runtime: RuntimeConfig, method: string, path: string, body?: unknown): Promise<T> {
  const response = await fetch(`${runtime.hubUrl}${path}`, {
    method,
    headers: {
      Authorization: `token ${runtime.hubApiToken}`,
      Accept: "application/json",
      ...(body === undefined ? {} : { "content-type": "application/json" }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(15_000),
  });
  const text = await response.text();
  let parsed: unknown = null;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    parsed = { message: text };
  }
  if (!response.ok) {
    const error = new Error(`JupyterHub returned ${response.status}`) as HubError;
    error.status = response.status;
    throw error;
  }
  return parsed as T;
}

function hubStatus(error: unknown): number | null {
  if (typeof error !== "object" || error === null || !("status" in error)) return null;
  const value = Number((error as { status?: unknown }).status);
  return Number.isFinite(value) ? value : null;
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
    const sessionEmail = normalizeEmail(idClaims.email) ?? email;
    const session: Session = {
      sessionId: randomUUID(),
      // Only the access token rides in the session cookie: the full token set
      // inflates the encrypted JWE past the ~4 KB browser cookie limit and the
      // cookie would be silently dropped by browsers.
      accessToken: result.AuthenticationResult.AccessToken,
      email: sessionEmail,
      username: sessionEmail,
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

app.get("/v1/sandboxes", async (request, reply) => {
  const session = await requireSession(request, reply);
  if (!session) return;
  try {
    const runtime = runtimeConfig();
    const user = await hubRequest<HubUser>(runtime, "GET", `/hub/api/users/${usernamePath(session.username)}`);
    const servers = Object.entries(user.servers ?? {}).map(([key, server]) => ({
      name: server.name || key || "default",
      state: server.state === "failed" ? "failed" : server.ready ? "running" : server.pending ? "pending" : "stopped",
      // Build the destination from trusted configuration and session identity;
      // never turn a Hub-provided URL into a user-facing link.
      url: server.ready && /^(default|[a-z0-9][a-z0-9-]{0,62})$/i.test(server.name || key)
        ? sandboxUrl(runtime.hubPublicUrl, session.username, server.name || key)
        : null,
      lastActivity: server.last_activity ?? null,
    }));
    return { user: { email: session.email }, sandboxes: servers };
  } catch (error) {
    // A user unknown to the Hub (never spawned a server) has an empty list, not an error.
    if (hubStatus(error) === 404) {
      return { user: { email: session.email }, sandboxes: [] };
    }
    request.log.error({ err: error }, "JupyterHub sandbox list failed");
    return handleHubError(reply, error);
  }
});

app.get("/v1/usage", async (request, reply) => {
  const session = await requireSession(request, reply);
  if (!session) return;
  try {
    const runtime = runtimeConfig();
    const quotas = {
      cpuHours: runtime.cpuQuotaHours,
      ramGb: runtime.ramQuotaGb,
      storageGb: runtime.storageQuotaGb,
      gpuHours: runtime.gpuQuotaHours,
    };
    let user: HubUser;
    try {
      user = await hubRequest<HubUser>(runtime, "GET", `/hub/api/users/${usernamePath(session.username)}`);
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
        await usageStore.sample(session.username, { runningServers: result.footprint.runningServers, cpuCoresAllocated: result.footprint.cpuCoresAllocated, ramGbAllocated: result.footprint.ramGbAllocated });
        result.history = await usageStore.history(session.username, 168);
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
    request.log.error({ err: error }, "JupyterHub usage query failed");
    return handleHubError(reply, error);
  }
});

app.get("/v1/usage/history", async (request, reply) => {
  const session = await requireSession(request, reply);
  if (!session) return;
  if (!usageStore) return { available: false, samples: [] };
  try {
    usageSchemaReady ??= usageStore.ensureSchema();
    await usageSchemaReady;
    return { available: true, samples: await usageStore.history(session.username, 168) };
  } catch (error) {
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
  try {
    const runtime = runtimeConfig();
    try {
      let user: HubUser;
      try {
        user = await hubRequest<HubUser>(runtime, "GET", `/hub/api/users/${usernamePath(session.username)}`);
      } catch (error) {
        if (hubStatus(error) !== 404) throw error;
        user = { servers: {} };
      }
      const currentServers = Object.entries(user.servers ?? {}).map(([key, server]) => usageServer(key, server));
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
        request.log.warn({ username: session.username }, "RAM quota check degraded; allowing sandbox start");
      }
    } catch (error) {
      enforcement = "degraded";
      request.log.warn({ err: error instanceof Error ? error.name : "hub_error", username: session.username }, "RAM quota check unavailable; allowing sandbox start");
    }
    await hubRequest(runtime, "POST", serverPath(session.username, request.params.name), {});
    return { ok: true, name: request.params.name, state: "pending", enforcement };
  } catch (error) {
    request.log.error({ err: error }, "JupyterHub sandbox start failed");
    if (hubStatus(error) === 404) {
      reply.code(409).send({ error: "HUB_USER_UNKNOWN", message: "Tài khoản chưa được kích hoạt trên Hub. Đăng nhập vào notebook hub một lần để kích hoạt." });
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
    await hubRequest(runtime, "DELETE", serverPath(session.username, request.params.name));
    return { ok: true, name: request.params.name, state: "stopped" };
  } catch (error) {
    request.log.error({ err: error }, "JupyterHub sandbox stop failed");
    return handleHubError(reply, error);
  }
});

app.listen({ port: config.port, host: config.host }).catch((error) => {
  app.log.error(error);
  process.exit(1);
});
