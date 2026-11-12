import assert from "node:assert/strict";
import test from "node:test";

import { chipColor, formatDuration, sandboxStateStatus, shortImage } from "./format.ts";

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
