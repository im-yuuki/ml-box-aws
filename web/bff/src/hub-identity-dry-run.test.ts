import assert from "node:assert/strict";
import test from "node:test";
import { runHubIdentityDryRun } from "./hub-identity-dry-run.js";
import type { HubIdentityMigrationReport } from "./hub-identity-migration.js";

type Output = { value: string };

function stream(output: Output) {
  return {
    write(chunk: string) {
      output.value += chunk;
      return true;
    },
  };
}

function report(canApply: boolean): HubIdentityMigrationReport {
  return {
    entries: [],
    summary: { total: 0, ready: 0, unchanged: 0, conflict: canApply ? 0 : 1 },
    conflicts: canApply ? [] : ["sub-conflict"],
    canApply,
  };
}

test("identity dry-run returns an error without a database URL", async () => {
  const stderr = { value: "" };
  let created = false;

  const exitCode = await runHubIdentityDryRun({
    env: {},
    createStore: () => {
      created = true;
      throw new Error("store should not be created");
    },
    stderr: stream(stderr),
  });

  assert.equal(exitCode, 1);
  assert.match(stderr.value, /APP_DATABASE_URL or DATABASE_URL is required/);
  assert.equal(created, false);
});

test("identity dry-run prints the report, closes the store, and blocks conflicts", async () => {
  const stdout = { value: "" };
  let closed = false;
  const expected = report(false);

  const exitCode = await runHubIdentityDryRun({
    env: { APP_DATABASE_URL: "postgres://redacted" },
    createStore: () => ({
      planHubIdentityMigration: async () => expected,
      close: async () => {
        closed = true;
      },
    }),
    stdout: stream(stdout),
  });

  assert.equal(exitCode, 2);
  assert.deepEqual(JSON.parse(stdout.value), expected);
  assert.equal(closed, true);
});

test("identity dry-run returns success when no conflicts are planned", async () => {
  const exitCode = await runHubIdentityDryRun({
    env: { DATABASE_URL: "postgres://redacted" },
    createStore: () => ({
      planHubIdentityMigration: async () => report(true),
      close: async () => undefined,
    }),
    stdout: stream({ value: "" }),
  });

  assert.equal(exitCode, 0);
});
