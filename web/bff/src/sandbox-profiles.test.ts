import assert from "node:assert/strict";
import test from "node:test";

import {
  DEFAULT_SANDBOX_PROFILE,
  listSandboxProfiles,
  resolveSandboxProfile,
} from "./sandbox-profiles.js";

test("absent request resolves to the default CPU profile", () => {
  const result = resolveSandboxProfile(undefined, false);
  assert.equal(result.ok, true);
  if (result.ok) assert.equal(result.profile.slug, DEFAULT_SANDBOX_PROFILE);
});

test("GPU profiles are hidden and rejected until GPU is enabled", () => {
  const offered = listSandboxProfiles(false).filter((profile) => profile.kind === "gpu");
  assert.ok(offered.length > 0);
  assert.ok(offered.every((profile) => profile.available === false));
  assert.deepEqual(resolveSandboxProfile("gpu-l4-shared", false), { ok: false, error: "PROFILE_UNAVAILABLE" });
  assert.equal(resolveSandboxProfile("gpu-l4-shared", true).ok, true);
});

test("unknown slugs are rejected", () => {
  assert.deepEqual(resolveSandboxProfile("cpu-huge", true), { ok: false, error: "UNKNOWN_PROFILE" });
});

test("CPU profiles are always available", () => {
  const cpu = listSandboxProfiles(false).filter((profile) => profile.kind === "cpu");
  assert.ok(cpu.length >= 3);
  assert.ok(cpu.every((profile) => profile.available));
});
