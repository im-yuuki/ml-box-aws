export type SpaceType = "personal" | "organization";
export type MockPlanStatus = "active" | "coming_soon";
export type MockPaymentMethod = "mock_card" | "mock_bank_transfer" | "mock_invoice";
export type MockPaymentOutcome = "succeeded" | "pending" | "failed" | "cancelled";
export type SubscriptionStatus = "inactive" | "pending" | "active" | "past_due" | "cancelled";

export function isMockPaymentMethod(value: unknown): value is MockPaymentMethod {
  return value === "mock_card" || value === "mock_bank_transfer" || value === "mock_invoice";
}

export function isMockPaymentOutcome(value: unknown): value is MockPaymentOutcome {
  return value === "succeeded" || value === "pending" || value === "failed" || value === "cancelled";
}

export type MockPlan = {
  id: string;
  spaceType: SpaceType;
  name: string;
  amountCents: number;
  currency: "USD";
  billingInterval: "month";
  status: MockPlanStatus;
  // How long Project artifacts are kept before the sweep deletes them. Null: plan not offered yet.
  artifactRetentionDays: number | null;
  /** One monthly pool of compute units shared by all runtimes in the Space (see COMPUTE_UNIT_RATES). */
  computeUnits: number | null;
  projects: number | null;
  storageGb: number | null;
  /** GPU runtimes are included from the cheapest paid plan upward. */
  gpuAccess: boolean;
  members?: number | null;
};

/**
 * Compute units consumed per runtime-hour. Keep this table the single place to tune the model.
 * Values are demo assumptions, not final prices.
 */
export const COMPUTE_UNIT_RATES = {
  cpuShared: 1,
  gpu: 10,
} as const;

/**
 * Longest a single usage session is billed. A runtime that stops without a BFF stop event (crash, node loss)
 * would otherwise accrue units forever; sessions past this bound are closed at the bound.
 */
export const MAX_USAGE_SESSION_HOURS = 24;

const plans: readonly MockPlan[] = [
  { id: "personal_free", spaceType: "personal", name: "Personal Free", amountCents: 0, currency: "USD", billingInterval: "month", status: "active", artifactRetentionDays: 7, computeUnits: 20, projects: 1, storageGb: 5, gpuAccess: false },
  { id: "personal_plus", spaceType: "personal", name: "Personal Plus", amountCents: 800, currency: "USD", billingInterval: "month", status: "active", artifactRetentionDays: 14, computeUnits: 100, projects: 5, storageGb: 25, gpuAccess: true },
  { id: "personal_pro", spaceType: "personal", name: "Personal Pro", amountCents: 1900, currency: "USD", billingInterval: "month", status: "active", artifactRetentionDays: 30, computeUnits: 300, projects: 20, storageGb: 100, gpuAccess: true },
  { id: "personal_power", spaceType: "personal", name: "Personal Power", amountCents: 3900, currency: "USD", billingInterval: "month", status: "coming_soon", artifactRetentionDays: null, computeUnits: null, projects: null, storageGb: null, gpuAccess: true },
  { id: "org_team", spaceType: "organization", name: "Organization Team", amountCents: 1900, currency: "USD", billingInterval: "month", status: "active", artifactRetentionDays: 14, computeUnits: 300, projects: 10, storageGb: 100, gpuAccess: true, members: 3 },
  { id: "org_growth", spaceType: "organization", name: "Organization Growth", amountCents: 800, currency: "USD", billingInterval: "month", status: "active", artifactRetentionDays: 30, computeUnits: 1000, projects: 50, storageGb: 500, gpuAccess: true, members: null },
  { id: "org_scale", spaceType: "organization", name: "Organization Scale", amountCents: 1500, currency: "USD", billingInterval: "month", status: "coming_soon", artifactRetentionDays: null, computeUnits: null, projects: null, storageGb: null, gpuAccess: true, members: null },
  { id: "org_enterprise", spaceType: "organization", name: "Organization Enterprise", amountCents: 0, currency: "USD", billingInterval: "month", status: "coming_soon", artifactRetentionDays: null, computeUnits: null, projects: null, storageGb: null, gpuAccess: true, members: null },
];

// Storage and retention for a Space. Without an active subscription the Space has the free tier.
export const FREE_PLAN_ID = "personal_free";
export function artifactPolicyForPlan(planId: string | null): { retentionDays: number; storageGb: number | null } {
  const plan = getMockPlan(planId ?? FREE_PLAN_ID) ?? getMockPlan(FREE_PLAN_ID);
  return {
    retentionDays: plan?.artifactRetentionDays ?? 7,
    storageGb: plan?.storageGb ?? null,
  };
}

export function listMockPlans(spaceType?: SpaceType): MockPlan[] {
  return plans.filter((plan) => !spaceType || plan.spaceType === spaceType).map((plan) => ({ ...plan }));
}

export function getMockPlan(planId: string): MockPlan | undefined {
  const plan = plans.find((candidate) => candidate.id === planId);
  return plan ? { ...plan } : undefined;
}

export function resolveSubscriptionStatus(outcome: MockPaymentOutcome): SubscriptionStatus {
  switch (outcome) {
    case "succeeded": return "active";
    case "pending": return "pending";
    case "failed": return "past_due";
    case "cancelled": return "cancelled";
  }
}

export function entitlementsForPlan(plan: MockPlan): Record<string, number | null> {
  const values: Record<string, number | null> = {
    compute_units: plan.computeUnits,
    projects: plan.projects,
    storage_gb: plan.storageGb,
    gpu_access: plan.gpuAccess ? 1 : 0,
  };
  if (plan.members !== undefined) values.members = plan.members;
  return values;
}

/** Runtime class used for metering and plan gating. */
export type RuntimeClass = "cpuShared" | "gpu";

/** Monthly compute-unit cost of running one runtime for `hours`. */
export function computeUnitsForRuntime(runtimeClass: RuntimeClass, hours: number): number {
  return Math.max(0, hours) * COMPUTE_UNIT_RATES[runtimeClass];
}

export function runtimeClassForProfile(kind: "cpu" | "gpu"): RuntimeClass {
  return kind === "gpu" ? "gpu" : "cpuShared";
}

export function unitsPerHourForRuntime(runtimeClass: RuntimeClass): number {
  return COMPUTE_UNIT_RATES[runtimeClass];
}

export type RuntimeAccessCode = "GPU_NOT_IN_PLAN" | "COMPUTE_UNITS_EXHAUSTED";

/** Plan-level permission for a runtime class, independent of how many units are left. */
export function planAllowsRuntime(plan: MockPlan, runtimeClass: RuntimeClass): RuntimeAccessCode | null {
  if (runtimeClass === "gpu" && !plan.gpuAccess) return "GPU_NOT_IN_PLAN";
  return null;
}

/** Whether a Space may start a runtime of this class. Returns the reason code when it may not. */
export function runtimeAccessDecision(plan: MockPlan, runtimeClass: RuntimeClass, unitsUsed: number): { allowed: true } | { allowed: false; code: RuntimeAccessCode } {
  const planCode = planAllowsRuntime(plan, runtimeClass);
  if (planCode) return { allowed: false, code: planCode };
  if (plan.computeUnits !== null && unitsUsed >= plan.computeUnits) return { allowed: false, code: "COMPUTE_UNITS_EXHAUSTED" };
  return { allowed: true };
}
