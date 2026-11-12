import assert from "node:assert/strict";
import test from "node:test";

import { loadConfig, parseHealthTargets } from "./config.js";

const base = { ADMIN_USERNAME: "admin", ADMIN_PASSWORD_HASH: "scrypt$x", ADMIN_SESSION_SECRET: "s".repeat(32) };

test("health targets keep only valid http entries", () => {
  assert.deepEqual(parseHealthTargets("bff=http://bff:4000/v1/health;bad;x=ftp://nope; web = https://example.com "), [
    { name: "bff", url: "http://bff:4000/v1/health" },
    { name: "web", url: "https://example.com" },
  ]);
  assert.deepEqual(parseHealthTargets(undefined), []);
});

test("config refuses to start without the login settings", () => {
  assert.throws(() => loadConfig({}), /ADMIN_USERNAME/);
});

test("config refuses a short session secret", () => {
  assert.throws(() => loadConfig({ ...base, ADMIN_SESSION_SECRET: "short" }), /at least 32/);
});

test("config applies safe defaults", () => {
  const config = loadConfig(base);
  assert.equal(config.secureCookies, true);
  assert.equal(config.costExplorerEnabled, false);
  assert.equal(config.databaseUrl, null);
  assert.equal(config.sessionTtlSeconds, 8 * 3600);
});
