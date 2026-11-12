import { createHmac, randomBytes, scrypt, scryptSync, timingSafeEqual } from "node:crypto";

// Password format: scrypt$<N>$<r>$<p>$<salt base64url>$<hash base64url>
const KEY_LENGTH = 32;
const DEFAULT_COST = { N: 16384, r: 8, p: 1 };

export function hashPassword(password: string, cost = DEFAULT_COST): string {
  const salt = randomBytes(16);
  const hash = scryptSync(password, salt, KEY_LENGTH, cost);
  return `scrypt$${cost.N}$${cost.r}$${cost.p}$${salt.toString("base64url")}$${hash.toString("base64url")}`;
}

function scryptAsync(password: string, salt: Buffer, options: { N: number; r: number; p: number }): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(password, salt, KEY_LENGTH, options, (error, key) => (error ? reject(error) : resolve(key)));
  });
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.split("$");
  if (parts.length !== 6 || parts[0] !== "scrypt") return false;
  const [, n, r, p, salt, hash] = parts;
  const options = { N: Number(n), r: Number(r), p: Number(p) };
  if (![options.N, options.r, options.p].every((value) => Number.isInteger(value) && value > 0)) return false;
  // Refuse costs that would let a corrupted value stall the event loop or exhaust memory.
  if (options.N > 1 << 20 || options.r > 32 || options.p > 16) return false;
  const expected = Buffer.from(hash, "base64url");
  if (expected.length !== KEY_LENGTH) return false;
  const actual = await scryptAsync(password, Buffer.from(salt, "base64url"), options);
  return timingSafeEqual(actual, expected);
}

/** Constant-time comparison that does not leak the length of the secret. */
export function safeEqual(a: string, b: string): boolean {
  const left = createHmac("sha256", "cmp").update(a).digest();
  const right = createHmac("sha256", "cmp").update(b).digest();
  return timingSafeEqual(left, right);
}

type SessionPayload = { sub: string; exp: number };

function sign(secret: string, body: string): string {
  return createHmac("sha256", secret).update(body).digest("base64url");
}

export function createSessionToken(secret: string, username: string, ttlSeconds: number, now = Date.now()): string {
  const payload: SessionPayload = { sub: username, exp: Math.floor(now / 1000) + ttlSeconds };
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${body}.${sign(secret, body)}`;
}

export function verifySessionToken(secret: string, token: string | undefined, now = Date.now()): string | null {
  if (!token) return null;
  const dot = token.indexOf(".");
  if (dot <= 0) return null;
  const body = token.slice(0, dot);
  const signature = token.slice(dot + 1);
  if (!safeEqual(signature, sign(secret, body))) return null;
  try {
    const payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as Partial<SessionPayload>;
    if (typeof payload.sub !== "string" || typeof payload.exp !== "number") return null;
    if (payload.exp * 1000 <= now) return null;
    return payload.sub;
  } catch {
    return null;
  }
}

/** Counts failed logins per client and locks the client out after too many in a window. */
export class LoginLimiter {
  private readonly failures = new Map<string, { count: number; first: number; lockedUntil: number }>();

  constructor(
    private readonly maxFailures = 5,
    private readonly windowMs = 15 * 60 * 1000,
    private readonly lockMs = 15 * 60 * 1000,
  ) {}

  /** Returns the seconds left of the lockout, or 0 when the client may try. */
  retryAfter(key: string, now = Date.now()): number {
    const entry = this.failures.get(key);
    if (!entry || entry.lockedUntil <= now) return 0;
    return Math.ceil((entry.lockedUntil - now) / 1000);
  }

  recordFailure(key: string, now = Date.now()): void {
    const entry = this.failures.get(key);
    if (!entry || now - entry.first > this.windowMs) {
      this.failures.set(key, { count: 1, first: now, lockedUntil: 0 });
      return;
    }
    entry.count += 1;
    if (entry.count >= this.maxFailures) entry.lockedUntil = now + this.lockMs;
  }

  recordSuccess(key: string): void {
    this.failures.delete(key);
  }
}
