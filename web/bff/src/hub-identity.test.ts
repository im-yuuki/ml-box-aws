import assert from "node:assert/strict";
import test from "node:test";
import {
  canonicalHubUsername,
  detectHubIdentityCollision,
  resolveHubIdentity,
  type HubIdentity,
} from "./hub-identity.js";

test("canonical Hub usernames are deterministic and Hub-safe", () => {
  assert.equal(canonicalHubUsername("abc-123"), "cognito-abc-123");
  assert.equal(canonicalHubUsername("abc-123"), canonicalHubUsername("abc-123"));
  assert.throws(() => canonicalHubUsername(""), /Invalid Cognito subject/);
  assert.throws(() => canonicalHubUsername("bad subject"), /Invalid Cognito subject/);
});

test("stored mappings take precedence over the current email", () => {
  const mapping: HubIdentity = {
    userId: "sub-1",
    hubUsername: "legacy@example.com",
    legacyEmail: "legacy@example.com",
    previousHubUsername: null,
    status: "migrated",
  };
  assert.deepEqual(resolveHubIdentity({
    userId: "sub-1",
    email: "renamed@example.com",
    mapping,
  }), mapping);
});

test("confirmed legacy email mapping remains compatible", () => {
  assert.deepEqual(resolveHubIdentity({
    userId: "sub-2",
    email: "legacy@example.com",
    legacyHubUsername: "legacy@example.com",
  }), {
    userId: "sub-2",
    hubUsername: "legacy@example.com",
    legacyEmail: "legacy@example.com",
    previousHubUsername: null,
    status: "legacy",
  });
});

test("new users receive the canonical Cognito-sub Hub username", () => {
  assert.deepEqual(resolveHubIdentity({ userId: "sub-3", email: "new@example.com" }), {
    userId: "sub-3",
    hubUsername: "cognito-sub-3",
    legacyEmail: "new@example.com",
    previousHubUsername: null,
    status: "mapped",
  });
});

test("email changes never replace an existing Hub identity", () => {
  const first = resolveHubIdentity({ userId: "sub-4", email: "first@example.com" });
  const renamed = resolveHubIdentity({
    userId: "sub-4",
    email: "second@example.com",
    mapping: first,
  });
  assert.equal(renamed.hubUsername, "cognito-sub-4");
  assert.equal(renamed.legacyEmail, "first@example.com");
});

test("collision detection reports conflicting usernames without choosing a winner", () => {
  const entries: HubIdentity[] = [
    { userId: "sub-a", hubUsername: "cognito-shared", legacyEmail: null, previousHubUsername: null, status: "mapped" },
    { userId: "sub-b", hubUsername: "cognito-shared", legacyEmail: null, previousHubUsername: null, status: "mapped" },
    { userId: "sub-c", hubUsername: "unique", legacyEmail: null, previousHubUsername: null, status: "mapped" },
    { userId: "sub-a", hubUsername: "cognito-shared", legacyEmail: null, previousHubUsername: null, status: "mapped" },
  ];
  assert.deepEqual(detectHubIdentityCollision(entries), ["cognito-shared"]);
  assert.equal(entries[0].hubUsername, "cognito-shared");
});
