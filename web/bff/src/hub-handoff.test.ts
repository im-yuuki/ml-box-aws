import assert from "node:assert/strict";
import { test } from "node:test";
import { buildHandoffUrl, generateHandoffCode, hashHandoffCode, sanitizeNextPath } from "./hub-handoff.js";

test("handoff codes are high-entropy and stored only as hashes", () => {
  const a = generateHandoffCode();
  const b = generateHandoffCode();
  assert.notEqual(a, b);
  assert.ok(a.length >= 43);
  assert.match(a, /^[A-Za-z0-9_-]+$/);
  assert.match(hashHandoffCode(a), /^[0-9a-f]{64}$/);
  assert.notEqual(hashHandoffCode(a), a);
});

test("next path only accepts notebook paths under /user/", () => {
  assert.equal(sanitizeNextPath("/user/cognito-abc/"), "/user/cognito-abc/");
  assert.equal(sanitizeNextPath("/user/cognito-abc/sandbox-1/"), "/user/cognito-abc/sandbox-1/");
  assert.equal(sanitizeNextPath("https://evil.example/"), "/hub/");
  assert.equal(sanitizeNextPath("//evil.example/user/x/"), "/hub/");
  assert.equal(sanitizeNextPath("/user/x/../../admin"), "/hub/");
  assert.equal(sanitizeNextPath(undefined), "/hub/");
});

test("handoff URL points at the Hub login handler with code and next", () => {
  const url = new URL(buildHandoffUrl("https://notebook.example", "abc_-", "/user/cognito-x/"));
  assert.equal(url.origin, "https://notebook.example");
  assert.equal(url.pathname, "/hub/mlbox/login");
  assert.equal(url.searchParams.get("code"), "abc_-");
  assert.equal(url.searchParams.get("next"), "/user/cognito-x/");
});
