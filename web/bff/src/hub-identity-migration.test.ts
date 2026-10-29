import assert from "node:assert/strict";
import test from "node:test";
import {
  planHubIdentityMigration,
  rollbackHubIdentity,
} from "./hub-identity-migration.js";
import type { HubIdentity } from "./hub-identity.js";

function identity(overrides: Partial<HubIdentity> = {}): HubIdentity {
  return {
    userId: "sub-a",
    hubUsername: "alice@example.com",
    legacyEmail: "alice@example.com",
    previousHubUsername: null,
    status: "legacy",
    ...overrides,
  };
}

test("Hub identity migration produces a deterministic dry-run report", () => {
  const report = planHubIdentityMigration([
    identity(),
    identity({ userId: "sub-b", hubUsername: "cognito-sub-b", legacyEmail: "bob@example.com", status: "mapped" }),
  ]);

  assert.deepEqual(report, [
    {
      userId: "sub-a",
      email: "alice@example.com",
      currentHubUsername: "alice@example.com",
      canonicalHubUsername: "cognito-sub-a",
      status: "ready",
      reason: "legacy username can be migrated",
    },
    {
      userId: "sub-b",
      email: "bob@example.com",
      currentHubUsername: "cognito-sub-b",
      canonicalHubUsername: "cognito-sub-b",
      status: "unchanged",
      reason: "canonical username already mapped",
    },
  ]);
});

test("Hub identity migration reports canonical and legacy username collisions without choosing a winner", () => {
  const entries = [
    identity({ userId: "sub-a", hubUsername: "shared-name" }),
    identity({ userId: "sub-b", hubUsername: "shared-name", legacyEmail: "bob@example.com" }),
  ];

  const report = planHubIdentityMigration(entries);

  assert.equal(report.every((entry: { status: string }) => entry.status === "conflict"), true);
  assert.equal(report.every((entry: { reason?: string }) => entry.reason?.includes("collision")), true);
  assert.equal(entries[0].hubUsername, "shared-name");
  assert.equal(entries[1].hubUsername, "shared-name");
});

test("Hub identity rollback restores the previous username and legacy status without mutating input", () => {
  const migrated = identity({
    hubUsername: "cognito-sub-a",
    previousHubUsername: "alice@example.com",
    status: "migrated",
  });

  const rolledBack = rollbackHubIdentity(migrated);

  assert.deepEqual(rolledBack, {
    ...migrated,
    hubUsername: "alice@example.com",
    previousHubUsername: null,
    status: "legacy",
  });
  assert.equal(migrated.hubUsername, "cognito-sub-a");
  assert.equal(migrated.status, "migrated");
});

test("Hub identity rollback leaves an unmigrated mapping unchanged", () => {
  const mapped = identity({ hubUsername: "cognito-sub-a", status: "mapped" });
  assert.deepEqual(rollbackHubIdentity(mapped), mapped);
});
