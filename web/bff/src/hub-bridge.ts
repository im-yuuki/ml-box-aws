import { createHash, timingSafeEqual } from "node:crypto";

// Bearer check for the internal Hub-auth endpoint. Both sides are hashed first so the
// comparison runs in constant time and a length mismatch cannot leak the token length.
export function bearerMatches(header: string | undefined, expected: string | undefined): boolean {
  if (!expected || !header) return false;
  const match = /^Bearer\s+(.+)$/.exec(header);
  if (!match) return false;
  const a = createHash("sha256").update(match[1]).digest();
  const b = createHash("sha256").update(expected).digest();
  return timingSafeEqual(a, b);
}
