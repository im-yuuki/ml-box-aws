// The plan catalog of the BFF (web/bff/src/mock-billing.ts), needed to change the plan of a Space and to show the
// compute-unit limit of a plan. The two copies are compared by plans.test.ts, which fails when they drift.

export type PlanSpaceType = "personal" | "organization";

export type Plan = {
  id: string;
  spaceType: PlanSpaceType;
  name: string;
  credits: number | null;
  concurrentSandboxes: number | null;
  storageGb: number | null;
  gpuAccess: boolean;
  members?: number | null;
};

export const FREE_PLAN_ID = "personal_free";

export const PLANS: readonly Plan[] = [
  { id: "personal_free", spaceType: "personal", name: "Personal Free", credits: 20, concurrentSandboxes: 1, storageGb: 5, gpuAccess: false },
  { id: "personal_plus", spaceType: "personal", name: "Personal Plus", credits: 100, concurrentSandboxes: 2, storageGb: 25, gpuAccess: true },
  { id: "personal_pro", spaceType: "personal", name: "Personal Pro", credits: 300, concurrentSandboxes: 5, storageGb: 100, gpuAccess: true },
  { id: "org_team", spaceType: "organization", name: "Team", credits: 300, concurrentSandboxes: 5, storageGb: 100, gpuAccess: true, members: 3 },
  { id: "org_growth", spaceType: "organization", name: "Team Plus", credits: 1000, concurrentSandboxes: 15, storageGb: 500, gpuAccess: true, members: null },
];

export function findPlan(planId: string | null | undefined): Plan | null {
  return PLANS.find((plan) => plan.id === planId) ?? null;
}

/** The plan a Space really runs on: its active subscription, or the free tier when it has none. */
export function effectivePlan(planId: string | null | undefined, status: string | null | undefined): Plan {
  const active = status === "active" ? findPlan(planId) : null;
  return active ?? (findPlan(FREE_PLAN_ID) as Plan);
}

/** Same rows the BFF writes into mlbox_space_entitlements for a plan (entitlementsForPlan). */
export function entitlementsFor(plan: Plan): Record<string, number | null> {
  const values: Record<string, number | null> = {
    credits: plan.credits,
    concurrent_sandboxes: plan.concurrentSandboxes,
    storage_gb: plan.storageGb,
    gpu_access: plan.gpuAccess ? 1 : 0,
  };
  if (plan.members !== undefined) values.members = plan.members;
  return values;
}

/** Plans a Space of this type may be moved to. */
export function plansForSpaceType(spaceType: string): Plan[] {
  return PLANS.filter((plan) => plan.spaceType === spaceType);
}
