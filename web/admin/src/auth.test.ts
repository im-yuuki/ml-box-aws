import assert from "node:assert/strict";
import test from "node:test";

import { createSessionToken, hashPassword, LoginLimiter, verifyPassword, verifySessionToken } from "./auth.js";

const cheap = { N: 1024, r: 8, p: 1 };
const SECRET = "x".repeat(40);

test("a password verifies against its own hash only", async () => {
  const stored = hashPassword("correct horse battery", cheap);
  assert.equal(await verifyPassword("correct horse battery", stored), true);
  assert.equal(await verifyPassword("wrong password!!", stored), false);
});

test("two hashes of the same password differ by salt", () => {
  assert.notEqual(hashPassword("same-password-12", cheap), hashPassword("same-password-12", cheap));
});

test("malformed or dangerous hashes are rejected without throwing", async () => {
  assert.equal(await verifyPassword("x", ""), false);
  assert.equal(await verifyPassword("x", "bcrypt$a$b"), false);
  assert.equal(await verifyPassword("x", "scrypt$1024$8$1$c2FsdA$c2hvcnQ"), false);
  assert.equal(await verifyPassword("x", `scrypt$${2 ** 30}$8$1$c2FsdA$${"A".repeat(43)}`), false);
});

test("a session token round-trips and expires", () => {
  const now = Date.UTC(2026, 10, 12);
  const token = createSessionToken(SECRET, "admin", 60, now);
  assert.equal(verifySessionToken(SECRET, token, now + 30_000), "admin");
  assert.equal(verifySessionToken(SECRET, token, now + 61_000), null);
});

test("a tampered or foreign session token is rejected", () => {
  const token = createSessionToken(SECRET, "admin", 60);
  const [body, signature] = token.split(".");
  const forged = Buffer.from(JSON.stringify({ sub: "root", exp: 9_999_999_999 })).toString("base64url");
  assert.equal(verifySessionToken(SECRET, `${forged}.${signature}`), null);
  assert.equal(verifySessionToken("y".repeat(40), token), null);
  assert.equal(verifySessionToken(SECRET, body), null);
  assert.equal(verifySessionToken(SECRET, undefined), null);
});

test("the limiter locks a client after repeated failures and forgives after success", () => {
  const limiter = new LoginLimiter(3, 60_000, 120_000);
  const now = 1_000_000;
  limiter.recordFailure("ip", now);
  limiter.recordFailure("ip", now + 1);
  assert.equal(limiter.retryAfter("ip", now + 2), 0);
  limiter.recordFailure("ip", now + 3);
  assert.equal(limiter.retryAfter("ip", now + 4), 120);
  assert.equal(limiter.retryAfter("ip", now + 121_000), 0);
  limiter.recordSuccess("ip");
  assert.equal(limiter.retryAfter("ip", now + 4), 0);
});

test("failures outside the window do not add up", () => {
  const limiter = new LoginLimiter(2, 1000, 5000);
  limiter.recordFailure("ip", 0);
  limiter.recordFailure("ip", 5000);
  assert.equal(limiter.retryAfter("ip", 5001), 0);
});
