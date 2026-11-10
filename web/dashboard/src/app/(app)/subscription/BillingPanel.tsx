"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Button, Card } from "@heroui/react";
import { Ban, Check, Circle, CircleCheck, CreditCard, RotateCcw } from "lucide-react";
import { useTranslations } from "next-intl";
import { bffFetch } from "@/lib/bffFetch";
import FeedbackAlert from "@/components/FeedbackAlert";

type SpaceType = "personal" | "organization";
type PlanStatus = "active" | "coming_soon";
type PaymentOutcome = "succeeded" | "pending" | "failed" | "cancelled";

type Plan = {
  id: string;
  spaceType: SpaceType;
  name: string;
  amountCents: number;
  currency: string;
  billingInterval: string;
  status: PlanStatus;
  credits: number | null;
  concurrentSandboxes: number | null;
  storageGb: number | null;
  gpuAccess: boolean;
  members?: number | null;
};

type Subscription = {
  spaceId: string;
  plan: string;
  status: string;
  provider: string;
  paymentId?: string | null;
  currentPeriodEnd?: string | null;
};

type Details = {
  spaceId: string;
  spaceType: SpaceType;
  subscription: Subscription | null;
  entitlements: Array<{
    resource: string;
    limitValue: number | null;
    sourcePlan: string;
  }>;
};

type Payment = {
  id: string;
  planId: string;
  amountCents: number;
  currency: string;
  paymentMethod: string;
  status: PaymentOutcome;
  failureCode: string | null;
  createdAt?: string;
};

type ErrorBody = { error?: string; message?: string };

/** Subscription page: pick a plan, then pay on the provider's checkout page. */
export default function BillingPanel() {
  const t = useTranslations("account");
  const router = useRouter();
  const searchParams = useSearchParams();
  const result = searchParams.get("result");
  const [plans, setPlans] = useState<Plan[]>([]);
  const [details, setDetails] = useState<Details | null>(null);
  const [payments, setPayments] = useState<Payment[]>([]);
  const [selectedPlanId, setSelectedPlanId] = useState("");
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const loadBilling = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [plansResponse, detailsResponse, paymentsResponse] =
        await Promise.all([
          bffFetch("/api/bff/subscriptions/plans", { cache: "no-store" }),
          bffFetch("/api/bff/subscription", { cache: "no-store" }),
          bffFetch("/api/bff/payments", { cache: "no-store" }),
        ]);
      if (!plansResponse.ok || !detailsResponse.ok || !paymentsResponse.ok)
        throw new Error("loadFailed");
      const planBody = (await plansResponse.json()) as { plans: Plan[] };
      const detailsBody = (await detailsResponse.json()) as Details;
      const paymentsBody = (await paymentsResponse.json()) as {
        payments: Payment[];
      };
      setPlans(planBody.plans);
      setDetails(detailsBody);
      setPayments(paymentsBody.payments);
      // Preselect the plan the Space is actually subscribed to. Falling back to the first
      // "active" plan in the catalog selected Personal Free while the account ran Personal Pro,
      // so the pay button silently downgraded the plan.
      const subscribed = detailsBody.subscription?.plan;
      setSelectedPlanId((current) => {
        if (current && planBody.plans.some((plan) => plan.id === current)) return current;
        const match = subscribed
          ? planBody.plans.find((plan) => plan.name === subscribed || plan.id === subscribed)
          : undefined;
        if (match) return match.id;
        return planBody.plans.find((plan) => plan.status === "active")?.id ?? "";
      });
    } catch {
      setError(t("billingLoadFailed"));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    const task = window.setTimeout(() => {
      void loadBilling();
    }, 0);
    return () => window.clearTimeout(task);
  }, [loadBilling]);

  // The checkout page returns here with ?result=succeeded|failed; show it once, then clean the URL.
  useEffect(() => {
    if (!result) return;
    const task = window.setTimeout(() => {
      setMessage(
        result === "succeeded" ? t("resultSucceeded") : t("resultFailed"),
      );
      router.replace("/subscription");
    }, 0);
    return () => window.clearTimeout(task);
  }, [result, router, t]);

  const selectedPlan = useMemo(
    () => plans.find((plan) => plan.id === selectedPlanId),
    [plans, selectedPlanId],
  );
  // The BFF returns the plan id ("personal_pro"); people know plans by name.
  const currentPlanLabel = useMemo(() => {
    const raw = details?.subscription?.plan;
    if (!raw) return null;
    const match = plans.find((plan) => plan.id === raw || plan.name === raw);
    return match ? match.name : raw;
  }, [details, plans]);
  const visiblePlans = plans.filter(
    (plan) => !details || plan.spaceType === details.spaceType,
  );
  const activePlans = visiblePlans.filter((plan) => plan.status === "active");
  const alreadySubscribed =
    !!selectedPlan &&
    details?.subscription?.plan === selectedPlan.name &&
    ["active", "pending"].includes(details.subscription.status);

  const cancelSubscription = async () => {
    setPending(true);
    setError(null);
    setMessage(null);
    try {
      const response = await bffFetch("/api/bff/subscription/cancel", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{}",
      });
      if (!response.ok) {
        const body = (await response.json().catch(() => ({}))) as ErrorBody;
        throw new Error(body.error ?? "billingRequestFailed");
      }
      setMessage(t("billingUpdated"));
      await loadBilling();
    } catch {
      setError(t("billingRequestFailed"));
    } finally {
      setPending(false);
    }
  };

  const formatPrice = (plan: Plan) =>
    plan.amountCents === 0
      ? t("billingFree")
      : new Intl.NumberFormat(undefined, {
          style: "currency",
          currency: plan.currency,
        }).format(plan.amountCents / 100) +
        (plan.id === "org_growth"
          ? t("billingPerMember")
          : t("billingPerMonth"));

  const formatQuota = (value: number | null, unit: string) =>
    value === null ? t("billingUnlimited") : `${value} ${unit}`;
  const statusLabel = (status: string) =>
    t(
      `billingStatus${status.charAt(0).toUpperCase()}${status.slice(1)}` as "billingStatusActive",
    );
  const outcomeLabel = (value: PaymentOutcome) =>
    t(
      `billingOutcome${value.charAt(0).toUpperCase()}${value.slice(1)}` as "billingOutcomeSucceeded",
    );
  // The entitlement resource ids come from the BFF (mock-billing.ts). Every one of them needs a
  // label and a unit: unknown ids used to be printed raw ("concurrent_sandboxes") and every
  // resource was rendered with the "hours" unit ("5 hours" for a sandbox count).
  const quotaLabel = (resource: string) => {
    const labels: Record<
      string,
      | "billingQuotaProjects"
      | "billingQuotaStorageGb"
      | "billingQuotaCredits"
      | "billingQuotaMembers"
      | "billingQuotaConcurrentSandboxes"
      | "billingQuotaCpuHours"
      | "billingQuotaGpuHours"
      | "billingQuotaGpuAccess"
    > = {
      projects: "billingQuotaProjects",
      storage_gb: "billingQuotaStorageGb",
      credits: "billingQuotaCredits",
      members: "billingQuotaMembers",
      concurrent_sandboxes: "billingQuotaConcurrentSandboxes",
      cpu_hours: "billingQuotaCpuHours",
      gpu_hours: "billingQuotaGpuHours",
      gpu_access: "billingQuotaGpuAccess",
    };
    const key = labels[resource];
    return key ? t(key) : resource;
  };

  const quotaUnit = (resource: string) => {
    if (resource === "storage_gb") return t("billingGb");
    if (resource === "members") return t("billingMembers");
    if (resource === "credits") return t("billingCredits");
    if (resource === "concurrent_sandboxes") return t("billingConcurrentSandboxes");
    if (resource === "cpu_hours" || resource === "gpu_hours") return t("billingHours");
    if (resource === "gpu_access") return t("billingGpuAccess");
    return t("billingProjects");
  };

  if (loading) {
    return (
      <Card className="p-5">
        <p className="text-sm" style={{ color: "var(--muted)" }}>
          {t("billingLoading")}
        </p>
      </Card>
    );
  }

  return (
    <div id="billing" className="flex scroll-mt-24 flex-col gap-6">
      {error ? (
        <FeedbackAlert status="danger">{error}</FeedbackAlert>
      ) : null}
      {message ? (
        <FeedbackAlert status="success">{message}</FeedbackAlert>
      ) : null}

      <Card>
        <Card.Header>
          <Card.Title>{t("currentSubscription")}</Card.Title>
        </Card.Header>
        <Card.Content className="flex flex-col gap-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <p className="text-sm" style={{ color: "var(--muted)" }}>
              {currentPlanLabel ?? t("noSubscription")}
            </p>
            {details?.subscription ? (
              <span
                className="rounded-full border px-3 py-1 text-xs"
                style={{ borderColor: "var(--border)" }}>
                {statusLabel(details.subscription.status)}
              </span>
            ) : null}
          </div>
          {details?.entitlements.length ? (
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              {details.entitlements.map((entitlement) => (
                <div
                  className="rounded-md border p-3"
                  style={{ borderColor: "var(--border)" }}
                  key={entitlement.resource}>
                  <p className="text-xs" style={{ color: "var(--muted)" }}>
                    {quotaLabel(entitlement.resource)}
                  </p>
                  <p className="text-sm font-medium">
                    {formatQuota(entitlement.limitValue, quotaUnit(entitlement.resource))}
                  </p>
                </div>
              ))}
            </div>
          ) : null}
          {details?.subscription &&
          ["active", "pending", "past_due"].includes(
            details.subscription.status,
          ) ? (
            <Button
              size="sm"
              variant="danger"
              onPress={() => void cancelSubscription()}
              isPending={pending}
              isDisabled={pending}
              fullWidth>
              <Ban aria-hidden="true" size={16} />
              {t("cancelSubscription")}
            </Button>
          ) : null}
        </Card.Content>
      </Card>

      <Card>
        <Card.Header>
          <Card.Title>{t("choosePlan")}</Card.Title>
        </Card.Header>
        <Card.Content className="flex flex-col gap-4">
          <div className="flex gap-3">
            {activePlans.map((plan) => (
              <button
                className="flex min-w-0 flex-1 flex-col gap-3 rounded-lg border p-4 text-left transition hover:border-accent"
                style={{
                  borderColor:
                    selectedPlanId === plan.id
                      ? "var(--accent)"
                      : "var(--border)",
                  background: "var(--surface)",
                }}
                type="button"
                key={plan.id}
                onClick={() => setSelectedPlanId(plan.id)}
                aria-pressed={selectedPlanId === plan.id}>
                <div className="flex items-start justify-between gap-2">
                  <span className="flex items-center gap-2 font-medium">
                    {selectedPlanId === plan.id ? (
                      <CircleCheck aria-hidden="true" size={16} />
                    ) : (
                      <Circle aria-hidden="true" size={16} />
                    )}
                    {plan.name}
                  </span>
                  <span className="text-sm">{formatPrice(plan)}</span>
                </div>
                <ul
                  className="flex flex-col gap-1.5 text-xs"
                  style={{ color: "var(--muted)" }}>
                  {[
                    formatQuota(plan.credits, t("billingCredits")),
                    formatQuota(plan.concurrentSandboxes, t("billingConcurrentSandboxes")),
                    formatQuota(plan.storageGb, t("billingGb")),
                    ...(plan.gpuAccess ? [t("billingGpuIncluded")] : []),
                  ].map((benefit) => (
                    <li key={benefit} className="flex items-start gap-2">
                      <Check aria-hidden="true" size={14} className="mt-px shrink-0" style={{ color: "var(--accent)" }} />
                      <span>{benefit}</span>
                    </li>
                  ))}
                </ul>
              </button>
            ))}
          </div>
          <div>
            {selectedPlan && !alreadySubscribed ? (
              <Button
                variant="primary"
                onPress={() =>
                  router.push(
                    `/payment/checkout?plan=${encodeURIComponent(selectedPlan.id)}`,
                  )
                }
                isDisabled={pending}
                fullWidth>
                <CreditCard aria-hidden="true" size={16} />
                {t("payPlan", { plan: selectedPlan.name })}
              </Button>
            ) : null}
          </div>
        </Card.Content>
      </Card>

      <Card>
        <Card.Header>
          <Card.Title>{t("paymentHistory")}</Card.Title>
        </Card.Header>
        <Card.Content className="flex flex-col gap-4">
          {payments.length === 0 ? (
            <p className="text-sm" style={{ color: "var(--muted)" }}>
              {t("paymentHistoryEmpty")}
            </p>
          ) : (
            <div className="flex flex-col gap-3">
              {payments.map((payment) => (
                <div
                  className="flex flex-wrap items-center justify-between gap-3 rounded-md border p-3"
                  style={{ borderColor: "var(--border)" }}
                  key={payment.id}>
                  <div>
                    <p className="text-sm font-medium">
                      {payment.planId} · {outcomeLabel(payment.status)}
                    </p>
                    <p className="text-xs" style={{ color: "var(--muted)" }}>
                      {payment.id}
                    </p>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="text-sm">
                      {new Intl.NumberFormat(undefined, {
                        style: "currency",
                        currency: payment.currency,
                      }).format(payment.amountCents / 100)}
                    </span>
                    {payment.status === "failed" ? (
                      <Link
                        href={`/payment/checkout?payment=${encodeURIComponent(payment.id)}`}>
                        <Button size="sm" variant="tertiary">
                          <RotateCcw aria-hidden="true" size={14} />
                          {t("retryPayment")}
                        </Button>
                      </Link>
                    ) : null}
                  </div>
                </div>
              ))}
            </div>
          )}
        </Card.Content>
      </Card>
    </div>
  );
}
