import assert from "node:assert/strict";
import test from "node:test";
import {
  getMockPlan,
  isMockPaymentMethod,
  isMockPaymentOutcome,
  listMockPlans,
  resolveSubscriptionStatus,
  entitlementsForPlan,
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
    projects: 1,
    storage_gb: 5,
    cpu_hours: 10,
    gpu_hours: 0,
  });
  assert.deepEqual(entitlementsForPlan(getMockPlan("org_team")!), {
    projects: 10,
    storage_gb: 100,
    cpu_hours: 300,
    gpu_hours: 0,
    members: 3,
  });
});
