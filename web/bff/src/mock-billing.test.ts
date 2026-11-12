import assert from "node:assert/strict";
import test from "node:test";
import {
  getMockPlan,
  effectivePlanForSpace,
  isMockPaymentMethod,
  isMockPaymentOutcome,
  listMockPlans,
  resolveSubscriptionStatus,
  entitlementsForPlan,
  creditsForRuntime,
  runtimeClassForProfile,
  runtimeAccessDecision,
  creditsPerHourForRuntime,
} from "./mock-billing.js";

test("mock catalog exposes the five active plans", () => {
  const plans = listMockPlans();

  assert.deepEqual(plans.map((plan) => plan.id), [
    "personal_free",
    "personal_plus",
    "personal_pro",
    "org_team",
    "org_growth",
  ]);
  assert.equal(plans.filter((plan) => plan.status === "active").length, 5);
  assert.equal(plans.filter((plan) => plan.status === "coming_soon").length, 0);
});

test("plan lookup and filtering preserve the server-owned space type", () => {
  assert.equal(getMockPlan("personal_plus")?.spaceType, "personal");
  assert.equal(getMockPlan("org_team")?.spaceType, "organization");
  assert.deepEqual(listMockPlans("personal").map((plan) => plan.id), [
    "personal_free",
    "personal_plus",
    "personal_pro",
  ]);
  assert.deepEqual(listMockPlans("organization").map((plan) => plan.id), [
    "org_team",
    "org_growth",
  ]);
});

test("the plan names shown to the user never say organization", () => {
  // The product has no organizations: a Space of several people is a team. The name of a plan is
  // printed on the subscription page and on the checkout page.
  for (const plan of listMockPlans()) {
    assert.equal(
      /organization/i.test(plan.name),
      false,
      `plan ${plan.id} shows the word organization to the user`,
    );
  }
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
    credits: 20,
    concurrent_sandboxes: 1,
    storage_gb: 5,
    gpu_access: 0,
  });
  assert.deepEqual(entitlementsForPlan(getMockPlan("org_team")!), {
    credits: 300,
    concurrent_sandboxes: 5,
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
  assert.equal(creditsForRuntime("cpuShared", 3), 3);
  assert.equal(creditsForRuntime("gpu", 0.5), 5);
  assert.equal(creditsForRuntime("gpu", -1), 0);
});

test("runtime class follows the profile kind: GPU or shared CPU", () => {
  assert.equal(runtimeClassForProfile("gpu"), "gpu");
  assert.equal(runtimeClassForProfile("cpu"), "cpuShared");
  assert.equal(creditsPerHourForRuntime("cpuShared"), 1);
});

test("runtime access: GPU needs a paid plan; units block once exhausted", () => {
  const free = getMockPlan("personal_free")!;
  const plus = getMockPlan("personal_plus")!;
  assert.deepEqual(runtimeAccessDecision(free, "gpu", 0), { allowed: false, code: "GPU_NOT_IN_PLAN" });
  assert.deepEqual(runtimeAccessDecision(plus, "gpu", 0), { allowed: true });
  assert.deepEqual(runtimeAccessDecision(free, "cpuShared", 19.9), { allowed: true });
  assert.deepEqual(runtimeAccessDecision(free, "cpuShared", 20), { allowed: false, code: "CREDITS_EXHAUSTED" });
  assert.equal(creditsPerHourForRuntime("gpu"), 10);
});

test("a Space without a subscription runs on the free tier", () => {
  // A brand new account has no subscription row at all; it must still report the free plan.
  const plan = effectivePlanForSpace(null);
  assert.equal(plan.id, "personal_free");
  assert.equal(plan.credits, 20);
  assert.equal(plan.concurrentSandboxes, 1);
  assert.equal(plan.storageGb, 5);
});

test("an unknown subscription id falls back to the free tier", () => {
  assert.equal(effectivePlanForSpace("plan_that_does_not_exist").id, "personal_free");
  assert.equal(effectivePlanForSpace(undefined).id, "personal_free");
});

test("an active subscription is the effective plan of the Space", () => {
  assert.equal(effectivePlanForSpace("personal_plus").id, "personal_plus");
  assert.equal(effectivePlanForSpace("org_team").credits, 300);
});
