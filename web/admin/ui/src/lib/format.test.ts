import assert from "node:assert/strict";
import test from "node:test";

import { chipColor, formatBytes, formatDuration, sandboxStateStatus, shortImage, usagePercent, usageStatus } from "./format.ts";

test("status words map to the HeroUI chip colours", () => {
  assert.equal(chipColor("ok"), "success");
  assert.equal(chipColor("warn"), "warning");
  assert.equal(chipColor("error"), "danger");
  assert.equal(chipColor("info"), "default");
});

test("sandbox states fall back to info when unknown", () => {
  assert.equal(sandboxStateStatus("running"), "ok");
  assert.equal(sandboxStateStatus("failed"), "error");
  assert.equal(sandboxStateStatus("something-new"), "info");
});

test("images are shortened to name and a short tag", () => {
  assert.equal(shortImage("ghcr.io/im-yuuki/mlbox-bff:dbcd98f087d6c56b08644a162476b0484cf275de"), "mlbox-bff:dbcd98f");
  assert.equal(shortImage("registry.k8s.io/coredns/coredns:v1.11.3"), "coredns:v1.11.3");
  assert.equal(shortImage("nginx"), "nginx:latest");
  assert.equal(shortImage("localhost:5000/app"), "app:latest");
  assert.equal(shortImage("repo/app@sha256:abc"), "app:latest");
});

test("durations split into hours and minutes and tolerate bad input", () => {
  assert.deepEqual(formatDuration(3 * 3600 + 25 * 60 + 40), { hours: 3, minutes: 25 });
  assert.deepEqual(formatDuration(-5), { hours: 0, minutes: 0 });
  assert.deepEqual(formatDuration(Number.NaN), { hours: 0, minutes: 0 });
});

test("bytes are shown in binary units", () => {
  assert.equal(formatBytes(0), "0 B");
  assert.equal(formatBytes(512), "512 B");
  assert.equal(formatBytes(12_000_000), "11.4 MiB");
  assert.equal(formatBytes(5 * 1024 ** 3), "5.0 GiB");
  assert.equal(formatBytes(Number.NaN), "0 B");
});

test("usage against a limit warns at 80 percent and fails at 100", () => {
  assert.equal(usageStatus(10, 100), "ok");
  assert.equal(usageStatus(80, 100), "warn");
  assert.equal(usageStatus(100, 100), "error");
  assert.equal(usageStatus(5, null), "info");
  assert.equal(usageStatus(1, 0), "error");
  assert.equal(usagePercent(150, 100), 100);
  assert.equal(usagePercent(25, 100), 25);
  assert.equal(usagePercent(5, null), 0);
});
