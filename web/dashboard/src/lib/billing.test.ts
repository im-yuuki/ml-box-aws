import assert from "node:assert/strict";
import test from "node:test";

import { entitlementLabel, entitlementValue } from "./billing.ts";

// A stand-in for next-intl's translate: it returns the key and the parameters, so the test
// checks what the component asks for instead of the wording itself.
const t = (key: string, params?: Record<string, string | number>) =>
  params ? `${key}:${JSON.stringify(params)}` : key;

test("every entitlement resource has a label, unknown ones keep their id", () => {
  assert.equal(entitlementLabel("credits", t), "billingQuotaCredits");
  assert.equal(entitlementLabel("storage_gb", t), "billingQuotaStorageGb");
  assert.equal(entitlementLabel("concurrent_sandboxes", t), "billingQuotaConcurrentSandboxes");
  assert.equal(entitlementLabel("members", t), "billingQuotaMembers");
  assert.equal(entitlementLabel("gpu_access", t), "billingQuotaGpuAccess");
  assert.equal(entitlementLabel("mystery_resource", t), "mystery_resource");
});

test("a single sandbox is not written in the plural", () => {
  assert.equal(
    entitlementValue("concurrent_sandboxes", 1, t),
    'billingSandboxLimit:{"count":1}',
  );
  assert.equal(
    entitlementValue("concurrent_sandboxes", 5, t),
    'billingSandboxLimit:{"count":5}',
  );
});

test("GPU access reads as included or missing, never as a number", () => {
  assert.equal(entitlementValue("gpu_access", 0, t), "billingGpuNone");
  assert.equal(entitlementValue("gpu_access", 1, t), "billingGpuIncluded");
});

test("a limit without a value is not specified", () => {
  assert.equal(entitlementValue("credits", null, t), "billingUnlimited");
});

test("credits, storage and members keep their unit", () => {
  assert.equal(entitlementValue("credits", 20, t), "20 billingCredits");
  assert.equal(entitlementValue("storage_gb", 5, t), "5 billingGb");
  assert.equal(entitlementValue("members", 3, t), "3 billingMembers");
  assert.equal(entitlementValue("projects", 4, t), "4 billingProjects");
});

test("GPU hours are not written as plain hours", () => {
  // "10 hours" next to a "GPU hours" label reads as the wrong unit.
  assert.equal(entitlementValue("gpu_hours", 10, t), "10 billingGpuHours");
  assert.equal(entitlementValue("cpu_hours", 10, t), "10 billingHours");
});
