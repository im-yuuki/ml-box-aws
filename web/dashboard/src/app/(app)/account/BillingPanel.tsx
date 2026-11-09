"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Alert, Button, Card } from "@heroui/react";
import { Ban, Circle, CircleCheck, CreditCard, RotateCcw } from "lucide-react";
import { useTranslations } from "next-intl";
import { bffFetch } from "@/lib/bffFetch";

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
  computeUnits: number | null;
  projects: number | null;
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
      setSelectedPlanId((current) =>
        current && planBody.plans.some((plan) => plan.id === current)
          ? current
          : (planBody.plans.find((plan) => plan.status === "active")?.id ?? ""),
      );
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
      router.replace("/account/subscription");
    }, 0);
    return () => window.clearTimeout(task);
  }, [result, router, t]);

  const selectedPlan = useMemo(
    () => plans.find((plan) => plan.id === selectedPlanId),
    [plans, selectedPlanId],
  );
  const visiblePlans = plans.filter(
    (plan) => !details || plan.spaceType === details.spaceType,
  );
  const activePlans = visiblePlans.filter((plan) => plan.status === "active");
  const upcomingPlans = visiblePlans.filter(
    (plan) => plan.status === "coming_soon",
  );
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
  const quotaLabel = (resource: string) => {
    const labels: Record<
      string,
      | "billingQuotaProjects"
      | "billingQuotaStorageGb"
      | "billingQuotaComputeUnits"
      | "billingQuotaMembers"
    > = {
      projects: "billingQuotaProjects",
      storage_gb: "billingQuotaStorageGb",
      compute_units: "billingQuotaComputeUnits",
      members: "billingQuotaMembers",
    };
    const key = labels[resource];
    return key ? t(key) : resource;
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
        <Alert status="danger">
          <Alert.Content>
            <Alert.Description>{error}</Alert.Description>
          </Alert.Content>
        </Alert>
      ) : null}
      {message ? (
        <Alert status="success">
          <Alert.Content>
            <Alert.Description>{message}</Alert.Description>
          </Alert.Content>
        </Alert>
      ) : null}

      <Card>
        <Card.Header>
          <Card.Title>{t("currentSubscription")}</Card.Title>
        </Card.Header>
        <Card.Content className="flex flex-col gap-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <p className="text-sm" style={{ color: "var(--muted)" }}>
              {details?.subscription
                ? details.subscription.plan
                : t("noSubscription")}
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
                    {formatQuota(
                      entitlement.limitValue,
                      entitlement.resource === "storage_gb"
                        ? t("billingGb")
                        : entitlement.resource === "members"
                          ? t("billingMembers")
                          : t("billingHours"),
                    )}
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
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {activePlans.map((plan) => (
              <button
                className="flex flex-col gap-3 rounded-lg border p-4 text-left transition hover:border-accent"
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
                <div
                  className="grid grid-cols-2 gap-1 text-xs"
                  style={{ color: "var(--muted)" }}>
                  <span>
                    {formatQuota(plan.computeUnits, t("billingComputeUnits"))}
                  </span>
                  <span>
                    {formatQuota(plan.projects, t("billingProjects"))}
                  </span>
                  <span>
                    {formatQuota(plan.storageGb, t("billingGb"))}
                  </span>
                  <span>
                    {plan.gpuAccess ? t("billingGpuIncluded") : t("billingGpuNotIncluded")}
                  </span>
                </div>
              </button>
            ))}
          </div>
          {upcomingPlans.length ? (
            <div>
              <p
                className="mb-2 text-xs font-medium"
                style={{ color: "var(--muted)" }}>
                {t("comingSoon")}
              </p>
              <div className="flex flex-wrap gap-2">
                {upcomingPlans.map((plan) => (
                  <span
                    className="rounded-full border px-3 py-1 text-xs"
                    style={{
                      borderColor: "var(--border)",
                      color: "var(--muted)",
                    }}
                    key={plan.id}>
                    {plan.name} · {t("comingSoon")}
                  </span>
                ))}
              </div>
            </div>
          ) : null}
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
