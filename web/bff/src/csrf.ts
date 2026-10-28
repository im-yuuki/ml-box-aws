import { timingSafeEqual } from "node:crypto";

export function validCsrfPair(cookieToken: unknown, headerToken: unknown): boolean {
  if (typeof cookieToken !== "string" || typeof headerToken !== "string") return false;
  const cookieBytes = Buffer.from(cookieToken);
  const headerBytes = Buffer.from(headerToken);
  return cookieBytes.length === headerBytes.length && timingSafeEqual(cookieBytes, headerBytes);
}
