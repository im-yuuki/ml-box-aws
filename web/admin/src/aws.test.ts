import assert from "node:assert/strict";
import test from "node:test";

import { certificateStatus, minutesSince, targetHealthStatus } from "./aws.js";
import { cached, clearCache } from "./cache.js";
import { probe } from "./health.js";

const NOW = Date.UTC(2026, 10, 12);

test("certificate status warns before expiry and fails after", () => {
  assert.equal(certificateStatus("ISSUED", new Date(NOW + 90 * 86400000), NOW).status, "ok");
  assert.equal(certificateStatus("ISSUED", new Date(NOW + 10 * 86400000), NOW).status, "warn");
  assert.equal(certificateStatus("ISSUED", new Date(NOW - 86400000), NOW).status, "error");
  assert.equal(certificateStatus("PENDING_VALIDATION", undefined, NOW).status, "warn");
  assert.equal(certificateStatus("FAILED", undefined, NOW).status, "error");
});

test("target health distinguishes partial from total failure", () => {
  assert.equal(targetHealthStatus(["healthy", "healthy"]).status, "ok");
  assert.equal(targetHealthStatus(["healthy", "unhealthy"]).status, "warn");
  assert.equal(targetHealthStatus(["unhealthy"]).status, "error");
  assert.equal(targetHealthStatus([]).status, "error");
});

test("minutesSince tolerates missing and invalid dates", () => {
  assert.equal(minutesSince(undefined, NOW), null);
  assert.equal(minutesSince("nonsense", NOW), null);
  assert.equal(minutesSince(new Date(NOW - 5 * 60000), NOW), 5);
});

test("a failing collector becomes an error section instead of throwing", async () => {
  clearCache();
  const result = await cached("boom", 1000, async () => {
    throw Object.assign(new Error("not allowed"), { name: "AccessDenied" });
  });
  assert.equal(result.ok, false);
  if (!result.ok) assert.match(result.error, /AccessDenied: not allowed/);
});

test("a successful collector is served from cache until it expires", async () => {
  clearCache();
  let calls = 0;
  let clock = 0;
  const load = async () => ++calls;
  await cached("k", 1000, load, () => clock);
  clock = 500;
  await cached("k", 1000, load, () => clock);
  assert.equal(calls, 1);
  clock = 1500;
  await cached("k", 1000, load, () => clock);
  assert.equal(calls, 2);
});

test("probe treats redirects as healthy and server errors as unhealthy", async () => {
  const respond = (status: number) => (async () => new Response(null, { status })) as unknown as typeof fetch;
  assert.equal((await probe({ name: "a", url: "http://a" }, respond(302))).ok, true);
  assert.equal((await probe({ name: "a", url: "http://a" }, respond(503))).ok, false);
  const failing = (async () => {
    throw new Error("refused");
  }) as unknown as typeof fetch;
  const result = await probe({ name: "a", url: "http://a" }, failing);
  assert.equal(result.ok, false);
  assert.equal(result.status, null);
});
