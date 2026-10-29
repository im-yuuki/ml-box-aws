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
  quotas: {
    projects: number | null;
    storageGb: number | null;
    cpuHours: number | null;
    gpuHours: number | null;
    members?: number | null;
  };
};

const plans: readonly MockPlan[] = [
  { id: "personal_free", spaceType: "personal", name: "Personal Free", amountCents: 0, currency: "USD", billingInterval: "month", status: "active", quotas: { projects: 1, storageGb: 5, cpuHours: 10, gpuHours: 0 } },
  { id: "personal_plus", spaceType: "personal", name: "Personal Plus", amountCents: 800, currency: "USD", billingInterval: "month", status: "active", quotas: { projects: 5, storageGb: 25, cpuHours: 50, gpuHours: 0 } },
  { id: "personal_pro", spaceType: "personal", name: "Personal Pro", amountCents: 1900, currency: "USD", billingInterval: "month", status: "active", quotas: { projects: 20, storageGb: 100, cpuHours: 200, gpuHours: 0 } },
  { id: "personal_power", spaceType: "personal", name: "Personal Power", amountCents: 3900, currency: "USD", billingInterval: "month", status: "coming_soon", quotas: { projects: null, storageGb: null, cpuHours: null, gpuHours: null } },
  { id: "org_team", spaceType: "organization", name: "Organization Team", amountCents: 1900, currency: "USD", billingInterval: "month", status: "active", quotas: { projects: 10, storageGb: 100, cpuHours: 300, gpuHours: 0, members: 3 } },
  { id: "org_growth", spaceType: "organization", name: "Organization Growth", amountCents: 800, currency: "USD", billingInterval: "month", status: "active", quotas: { projects: 50, storageGb: 500, cpuHours: 1000, gpuHours: 0, members: null } },
  { id: "org_scale", spaceType: "organization", name: "Organization Scale", amountCents: 1500, currency: "USD", billingInterval: "month", status: "coming_soon", quotas: { projects: null, storageGb: null, cpuHours: null, gpuHours: null, members: null } },
  { id: "org_enterprise", spaceType: "organization", name: "Organization Enterprise", amountCents: 0, currency: "USD", billingInterval: "month", status: "coming_soon", quotas: { projects: null, storageGb: null, cpuHours: null, gpuHours: null, members: null } },
];

export function listMockPlans(spaceType?: SpaceType): MockPlan[] {
  return plans.filter((plan) => !spaceType || plan.spaceType === spaceType).map((plan) => ({ ...plan, quotas: { ...plan.quotas } }));
}

export function getMockPlan(planId: string): MockPlan | undefined {
  const plan = plans.find((candidate) => candidate.id === planId);
  return plan ? { ...plan, quotas: { ...plan.quotas } } : undefined;
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
    projects: plan.quotas.projects,
    storage_gb: plan.quotas.storageGb,
    cpu_hours: plan.quotas.cpuHours,
    gpu_hours: plan.quotas.gpuHours,
  };
  if (plan.quotas.members !== undefined) values.members = plan.quotas.members;
  return values;
}
