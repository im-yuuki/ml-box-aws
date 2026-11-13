import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { effectivePlan, entitlementsFor, findPlan, plansForSpaceType, PLANS } from "./plans.js";

const here = dirname(fileURLToPath(import.meta.url));

/** The plan objects of the BFF catalog, read from its source so a change there fails this test. */
function bffPlans(): Record<string, Record<string, string>> {
  const source = readFileSync(join(here, "..", "..", "bff", "src", "mock-billing.ts"), "utf8");
  const result: Record<string, Record<string, string>> = {};
  for (const line of source.split("\n")) {
    const id = line.match(/\{ id: "([a-z_]+)", spaceType:/)?.[1];
    if (!id) continue;
    const fields: Record<string, string> = {};
    for (const match of line.matchAll(/(\w+): ("[^"]*"|-?\d+|true|false|null)/g)) fields[match[1]] = match[2].replace(/"/g, "");
    result[id] = fields;
  }
  return result;
}

test("the plan catalog matches the BFF catalog", () => {
  const catalog = bffPlans();
  assert.deepEqual(Object.keys(catalog).sort(), PLANS.map((plan) => plan.id).sort());
  for (const plan of PLANS) {
    const bff = catalog[plan.id];
    assert.equal(bff.spaceType, plan.spaceType, plan.id);
    assert.equal(bff.credits, String(plan.credits), `${plan.id} credits`);
    assert.equal(bff.concurrentSandboxes, String(plan.concurrentSandboxes), `${plan.id} concurrentSandboxes`);
    assert.equal(bff.storageGb, String(plan.storageGb), `${plan.id} storageGb`);
    assert.equal(bff.gpuAccess, String(plan.gpuAccess), `${plan.id} gpuAccess`);
    assert.equal(bff.members, plan.members === undefined ? undefined : String(plan.members), `${plan.id} members`);
  }
});

test("entitlements are the rows the BFF writes for a plan", () => {
  assert.deepEqual(entitlementsFor(findPlan("personal_plus")!), { credits: 100, concurrent_sandboxes: 2, storage_gb: 25, gpu_access: 1 });
  assert.deepEqual(entitlementsFor(findPlan("org_growth")!), { credits: 1000, concurrent_sandboxes: 15, storage_gb: 500, gpu_access: 1, members: null });
  assert.equal(entitlementsFor(findPlan("personal_free")!).gpu_access, 0);
});

test("a Space without an active subscription runs on the free plan", () => {
  assert.equal(effectivePlan(null, null).id, "personal_free");
  assert.equal(effectivePlan("personal_pro", "past_due").id, "personal_free");
  assert.equal(effectivePlan("personal_pro", "active").id, "personal_pro");
  assert.equal(effectivePlan("unknown_plan", "active").id, "personal_free");
});

test("a Space can only move to plans of its own type", () => {
  assert.deepEqual(plansForSpaceType("organization").map((plan) => plan.id), ["org_team", "org_growth"]);
  assert.equal(plansForSpaceType("personal").length, 3);
  assert.equal(plansForSpaceType("alien").length, 0);
});
