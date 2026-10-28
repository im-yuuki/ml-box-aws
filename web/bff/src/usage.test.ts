import assert from "node:assert/strict";
import test from "node:test";
import { buildUsageResponse, checkRamQuota, parseCpuCores, parseMemoryGb } from "./usage.js";

test("buildUsageResponse reports policy quotas and realtime footprint separately", () => {
  const response = buildUsageResponse([
    {
      name: "cpu",
      state: "running",
      url: null,
      lastActivity: "2026-10-27T00:00:00.000Z",
      cpuCoresAllocated: 2,
      ramGbAllocated: 4,
    },
    {
      name: "starting",
      state: "pending",
      url: null,
      lastActivity: null,
      cpuCoresAllocated: null,
      ramGbAllocated: null,
    },
  ], { cpuHours: 32, ramGb: 24, storageGb: 20, gpuHours: 0 }, "2026-10-27T01:00:00.000Z");

  assert.equal(response.generatedAt, "2026-10-27T01:00:00.000Z");
  assert.equal(response.quota.cpuHours.limit, 32);
  assert.equal(response.quota.cpuHours.usage, null);
  assert.equal(response.quota.storageGb.usage, null);
  assert.equal(response.quota.gpuHours.tracking, "disabled");
  assert.equal(response.quota.ramGb.usage, 4);
  assert.equal(response.footprint.runningServers, 1);
  assert.equal(response.footprint.pendingServers, 1);
  assert.equal(response.footprint.cpuCoresAllocated, 2);
  assert.equal(response.footprint.ramGbAllocated, 4);
});

test("empty server lists produce zero realtime footprint", () => {
  const response = buildUsageResponse([], { cpuHours: 32, ramGb: 24, storageGb: 20, gpuHours: 0 });
  assert.equal(response.footprint.runningServers, 0);
  assert.equal(response.footprint.pendingServers, 0);
  assert.equal(response.footprint.cpuCoresAllocated, 0);
  assert.equal(response.footprint.ramGbAllocated, 0);
  assert.equal(response.quota.ramGb.usage, 0);
});

test("unknown resource metadata remains null instead of becoming a guessed value", () => {
  const response = buildUsageResponse([{
    name: "unknown",
    state: "running",
    url: null,
    lastActivity: null,
    cpuCoresAllocated: null,
    ramGbAllocated: null,
  }], { cpuHours: 32, ramGb: 24, storageGb: 20, gpuHours: 0 });
  assert.equal(response.footprint.cpuCoresAllocated, null);
  assert.equal(response.footprint.ramGbAllocated, null);
  assert.equal(response.quota.ramGb.usage, null);
});

test("resource quantity parsers support Kubernetes-style values", () => {
  assert.equal(parseCpuCores("500m"), 0.5);
  assert.equal(parseCpuCores("2"), 2);
  assert.equal(parseMemoryGb("4G"), 4);
  assert.equal(parseMemoryGb("512Mi"), 0.5);
  assert.equal(parseMemoryGb("unknown"), null);
});

test("RAM quota blocks when active allocation plus the default 1 GiB request exceeds the limit", () => {
  const decision = checkRamQuota([
    { name: "one", state: "running", url: null, lastActivity: null, cpuCoresAllocated: 0.5, ramGbAllocated: 1 },
    { name: "two", state: "pending", url: null, lastActivity: null, cpuCoresAllocated: null, ramGbAllocated: 3 },
  ], 4);
  assert.deepEqual(decision, { allowed: false, enforcement: "enforced", currentGb: 4, requestedGb: 1, limitGb: 4 });
});

test("RAM quota fails open when an active allocation is unknown", () => {
  const decision = checkRamQuota([
    { name: "unknown", state: "running", url: null, lastActivity: null, cpuCoresAllocated: null, ramGbAllocated: null },
  ], 4);
  assert.deepEqual(decision, { allowed: true, enforcement: "degraded", limitGb: 4 });
});

test("RAM quota does not count stopped servers", () => {
  const decision = checkRamQuota([
    { name: "stopped", state: "stopped", url: null, lastActivity: null, cpuCoresAllocated: null, ramGbAllocated: null },
  ], 1);
  assert.deepEqual(decision, { allowed: true, enforcement: "enforced", currentGb: 0, limitGb: 1 });
});
