import assert from "node:assert/strict";
import test from "node:test";
import {
  getMockPlan,
  isMockPaymentMethod,
  isMockPaymentOutcome,
  listMockPlans,
  resolveSubscriptionStatus,
  entitlementsForPlan,
  computeUnitsForRuntime,
  runtimeClassForProfile,
  runtimeAccessDecision,
  unitsPerHourForRuntime,
} from "./mock-billing.js";

test("mock catalog exposes five active plans and three coming-soon plans", () => {
  const plans = listMockPlans();

  assert.deepEqual(plans.map((plan) => plan.id), [
    "personal_free",
    "personal_plus",
    "personal_pro",
    "personal_power",
    "org_team",
    "org_growth",
    "org_scale",
    "org_enterprise",
  ]);
  assert.equal(plans.filter((plan) => plan.status === "active").length, 5);
  assert.equal(plans.filter((plan) => plan.status === "coming_soon").length, 3);
});

test("plan lookup and filtering preserve the server-owned space type", () => {
  assert.equal(getMockPlan("personal_plus")?.spaceType, "personal");
  assert.equal(getMockPlan("org_team")?.spaceType, "organization");
  assert.deepEqual(listMockPlans("personal").map((plan) => plan.id), [
    "personal_free",
    "personal_plus",
    "personal_pro",
    "personal_power",
  ]);
  assert.deepEqual(listMockPlans("organization").map((plan) => plan.id), [
    "org_team",
    "org_growth",
    "org_scale",
    "org_enterprise",
  ]);
});

test("mock payment outcomes map to explicit subscription states", () => {
  assert.equal(resolveSubscriptionStatus("succeeded"), "active");
  assert.equal(resolveSubscriptionStatus("pending"), "pending");
  assert.equal(resolveSubscriptionStatus("failed"), "past_due");
  assert.equal(resolveSubscriptionStatus("cancelled"), "cancelled");
});

test("payment input guards accept only the mock catalog values", () => {
  assert.equal(isMockPaymentMethod("mock_card"), true);
  assert.equal(isMockPaymentMethod("stripe"), false);
  assert.equal(isMockPaymentOutcome("succeeded"), true);
  assert.equal(isMockPaymentOutcome("refunded"), false);
});

test("plan entitlements are demo-only values", () => {
  assert.deepEqual(entitlementsForPlan(getMockPlan("personal_free")!), {
    compute_units: 20,
    projects: 1,
    storage_gb: 5,
    gpu_access: 0,
  });
  assert.deepEqual(entitlementsForPlan(getMockPlan("org_team")!), {
    compute_units: 300,
    projects: 10,
    storage_gb: 100,
    gpu_access: 1,
    members: 3,
  });
});

test("GPU is included from the cheapest paid plan upward, never on Free", () => {
  const paid = listMockPlans("personal").filter((plan) => plan.status === "active" && plan.amountCents > 0);
  assert.ok(paid.length > 0);
  assert.ok(paid.every((plan) => plan.gpuAccess));
  assert.equal(getMockPlan("personal_free")?.gpuAccess, false);
});

test("compute units convert runtime hours using the single rate table", () => {
  assert.equal(computeUnitsForRuntime("cpuShared", 3), 3);
  assert.equal(computeUnitsForRuntime("gpu", 0.5), 5);
  assert.equal(computeUnitsForRuntime("gpu", -1), 0);
});

test("runtime class follows the profile kind: GPU or shared CPU", () => {
  assert.equal(runtimeClassForProfile("gpu"), "gpu");
  assert.equal(runtimeClassForProfile("cpu"), "cpuShared");
  assert.equal(unitsPerHourForRuntime("cpuShared"), 1);
});

test("runtime access: GPU needs a paid plan; units block once exhausted", () => {
  const free = getMockPlan("personal_free")!;
  const plus = getMockPlan("personal_plus")!;
  assert.deepEqual(runtimeAccessDecision(free, "gpu", 0), { allowed: false, code: "GPU_NOT_IN_PLAN" });
  assert.deepEqual(runtimeAccessDecision(plus, "gpu", 0), { allowed: true });
  assert.deepEqual(runtimeAccessDecision(free, "cpuShared", 19.9), { allowed: true });
  assert.deepEqual(runtimeAccessDecision(free, "cpuShared", 20), { allowed: false, code: "COMPUTE_UNITS_EXHAUSTED" });
  assert.equal(unitsPerHourForRuntime("gpu"), 10);
});
