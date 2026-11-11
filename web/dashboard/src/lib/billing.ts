/**
 * Wording of the plan limits shown on the Subscription page. The limits arrive from the BFF as
 * resource/limitValue pairs, so every wording decision lives here where it can be tested.
 */

type Translate = (key: string, params?: Record<string, string | number>) => string;

// The label above a limit, e.g. "Sandboxes running at once".
const LABEL_KEYS: Record<string, string> = {
  projects: "billingQuotaProjects",
  storage_gb: "billingQuotaStorageGb",
  credits: "billingQuotaCredits",
  members: "billingQuotaMembers",
  concurrent_sandboxes: "billingQuotaConcurrentSandboxes",
  cpu_hours: "billingQuotaCpuHours",
  gpu_hours: "billingQuotaGpuHours",
  gpu_access: "billingQuotaGpuAccess",
};

// The unit behind a limit, e.g. "GB storage". Sandbox and GPU limits are worded separately.
const UNIT_KEYS: Record<string, string> = {
  projects: "billingProjects",
  storage_gb: "billingGb",
  credits: "billingCredits",
  members: "billingMembers",
  cpu_hours: "billingHours",
  gpu_hours: "billingHours",
};

/** The label of a limit; unknown resources keep their raw id so nothing is hidden. */
export function entitlementLabel(resource: string, t: Translate): string {
  const key = LABEL_KEYS[resource];
  return key ? t(key) : resource;
}

/**
 * The value of a limit, e.g. "1 sandbox running at once". Sandbox counts follow the number and
 * GPU access reads as "No GPU access" instead of "0 GPU access".
 */
export function entitlementValue(resource: string, limitValue: number | null, t: Translate): string {
  if (limitValue === null) return t("billingUnlimited");
  if (resource === "gpu_access") {
    return limitValue === 0 ? t("billingGpuNone") : t("billingGpuIncluded");
  }
  if (resource === "concurrent_sandboxes") {
    return t("billingSandboxLimit", { count: limitValue });
  }
  const unit = UNIT_KEYS[resource];
  return unit ? `${limitValue} ${t(unit)}` : `${limitValue}`;
}
