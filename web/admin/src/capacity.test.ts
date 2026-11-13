import assert from "node:assert/strict";
import test from "node:test";

import { classifyClaim, parseStorageToGiB, podGpuRequest, quotaFamily, quotaLevel, unschedulableReason, type KnownProject, type VolumeClaimRow } from "./capacity.js";

test("instance types count against the right vCPU quota", () => {
  assert.equal(quotaFamily("g4dn.xlarge"), "gvt");
  assert.equal(quotaFamily("g6.2xlarge"), "gvt");
  assert.equal(quotaFamily("vt1.3xlarge"), "gvt");
  assert.equal(quotaFamily("t4g.large"), "standard");
  assert.equal(quotaFamily("m6i.large"), "standard");
  assert.equal(quotaFamily("c7g.xlarge"), "standard");
  assert.equal(quotaFamily("p4d.24xlarge"), "other");
  assert.equal(quotaFamily("inf2.xlarge"), "other");
});

test("a pod asks for GPUs in a limit, and requests win when both exist", () => {
  assert.equal(podGpuRequest([{ resources: { limits: { "nvidia.com/gpu": "1" } } }, { resources: { requests: { "nvidia.com/gpu": "2" }, limits: { "nvidia.com/gpu": "9" } } }]), 3);
  assert.equal(podGpuRequest([{ resources: { requests: { cpu: "1" } } }, {}]), 0);
  assert.equal(podGpuRequest(undefined), 0);
  assert.equal(podGpuRequest([{ resources: { limits: { "nvidia.com/gpu": "many" } } }]), 0);
});

test("the scheduler's reason is passed on only for an unscheduled pod", () => {
  assert.deepEqual(unschedulableReason([{ type: "PodScheduled", status: "False", reason: "Unschedulable", message: "0/3 nodes are available" }]), { reason: "Unschedulable", message: "0/3 nodes are available" });
  assert.equal(unschedulableReason([{ type: "PodScheduled", status: "True" }]), null);
  assert.equal(unschedulableReason(undefined), null);
});

test("a quota warns from 80 percent and is full at 100", () => {
  assert.equal(quotaLevel(8, 4), "ok");
  assert.equal(quotaLevel(8, 7), "warn");
  assert.equal(quotaLevel(8, 8), "error");
  assert.equal(quotaLevel(0, 0), "error", "a quota of zero cannot start anything");
  assert.equal(quotaLevel(null, 0), "error");
});

test("claims are matched to Projects by the server name the Hub wrote", () => {
  const projects = new Map<string, KnownProject>([
    ["p1", { name: "demo", spaceName: "Alice", deleted: false }],
    ["p3", { name: "gone", spaceName: "Bob", deleted: true }],
  ]);
  const claim = (serverName: string | null): VolumeClaimRow => ({ namespace: "hub", name: "c", phase: "Bound", size: "10Gi", storageClass: "efs", serverName });
  assert.equal(classifyClaim(claim("p1"), projects).status, "ok");
  assert.equal(classifyClaim(claim("p3"), projects).status, "deletedProject");
  assert.equal(classifyClaim(claim("p9"), projects).status, "unknownProject");
  assert.equal(classifyClaim(claim(null), projects).status, "unlabelled");
  assert.equal(classifyClaim(claim("p1"), projects).project?.name, "demo");
});

test("storage sizes convert to GiB", () => {
  assert.equal(parseStorageToGiB("10Gi"), 10);
  assert.equal(parseStorageToGiB("1Ti"), 1024);
  assert.equal(parseStorageToGiB("512Mi"), 0.5);
  assert.equal(parseStorageToGiB("garbage"), null);
  assert.equal(parseStorageToGiB(null), null);
});
