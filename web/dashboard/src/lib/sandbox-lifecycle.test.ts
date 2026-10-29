import assert from "node:assert/strict";
import test from "node:test";

import {
  MAX_STARTING_REFRESHES,
  SANDBOX_REFRESH_INTERVAL_MS,
  getSandboxLifecycleView,
  hasStartingSandbox,
  type SandboxLifecycleState,
} from "./sandbox-lifecycle.ts";

test("sandbox lifecycle states expose the correct controls", () => {
  const expected: Record<SandboxLifecycleState, ReturnType<typeof getSandboxLifecycleView>> = {
    ready: { label: "stateReady", action: "open", canStop: true, disabled: false },
    starting: { label: "stateStarting", action: "none", canStop: false, disabled: true },
    stopped: { label: "stateStopped", action: "start", canStop: false, disabled: false },
    failed: { label: "stateFailed", action: "restart", canStop: false, disabled: false },
  };

  for (const [state, view] of Object.entries(expected) as Array<[SandboxLifecycleState, ReturnType<typeof getSandboxLifecycleView>]>) {
    assert.deepEqual(getSandboxLifecycleView(state), view);
  }
});

test("sandbox refreshes only while starting and stays bounded", () => {
  assert.equal(hasStartingSandbox([{ state: "starting" }]), true);
  assert.equal(hasStartingSandbox([{ state: "ready" }, { state: "failed" }]), false);
  assert.equal(SANDBOX_REFRESH_INTERVAL_MS >= 1000, true);
  assert.equal(MAX_STARTING_REFRESHES > 0, true);
});
