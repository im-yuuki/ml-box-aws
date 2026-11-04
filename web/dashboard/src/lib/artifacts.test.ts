import assert from "node:assert/strict";
import test from "node:test";

import { ARTIFACT_MAX_BYTES, formatBytes, runtimeStateKey, validateUploadFile } from "./artifacts.ts";

test("upload validation rejects empty, oversized and blank-named files", () => {
  assert.deepEqual(validateUploadFile({ name: "a.csv", size: 10 }), { ok: true });
  assert.deepEqual(validateUploadFile({ name: "a.csv", size: 0 }), { ok: false, reason: "empty" });
  assert.deepEqual(validateUploadFile({ name: "a.csv", size: ARTIFACT_MAX_BYTES + 1 }), { ok: false, reason: "tooLarge" });
  assert.deepEqual(validateUploadFile({ name: "   ", size: 10 }), { ok: false, reason: "name" });
});

test("byte counts are formatted with readable units", () => {
  assert.equal(formatBytes(512), "512 B");
  assert.equal(formatBytes(2048), "2.0 KB");
  assert.equal(formatBytes(20 * 1024 * 1024), "20 MB");
  assert.equal(formatBytes(-1), "—");
});

test("Hub server states map to display keys and unknown states stay unknown", () => {
  assert.equal(runtimeStateKey("ready"), "running");
  assert.equal(runtimeStateKey("starting"), "starting");
  assert.equal(runtimeStateKey("stopped"), "stopped");
  assert.equal(runtimeStateKey("failed"), "failed");
  assert.equal(runtimeStateKey("weird"), "unknown");
  assert.equal(runtimeStateKey(null), "unknown");
});
