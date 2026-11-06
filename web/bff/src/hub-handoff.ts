import { createHash, randomBytes } from "node:crypto";

// One-time handoff from the dashboard session to the Hub. The code is 256 bits, stored only as a
// SHA-256 hash, valid for HANDOFF_TTL_SECONDS and redeemable exactly once (see AppStore).
export const HANDOFF_TTL_SECONDS = 60;
const DEFAULT_NEXT_PATH = "/hub/";
const NEXT_PATH_PATTERN = /^\/user\/[A-Za-z0-9-]{1,80}\/(?:[a-z0-9][a-z0-9-]{0,62}\/)?$/;

export function generateHandoffCode(): string {
  return randomBytes(32).toString("base64url");
}

export function hashHandoffCode(code: string): string {
  return createHash("sha256").update(code).digest("hex");
}

// Only notebook paths under /user/ are allowed as post-login destinations, so the handoff
// cannot be turned into an open redirect.
export function sanitizeNextPath(path: unknown): string {
  if (typeof path !== "string") return DEFAULT_NEXT_PATH;
  return NEXT_PATH_PATTERN.test(path) ? path : DEFAULT_NEXT_PATH;
}

export function buildHandoffUrl(hubOrigin: string, code: string, nextPath: string): string {
  const url = new URL("/hub/mlbox/login", hubOrigin);
  url.searchParams.set("code", code);
  url.searchParams.set("next", nextPath);
  return url.toString();
}
