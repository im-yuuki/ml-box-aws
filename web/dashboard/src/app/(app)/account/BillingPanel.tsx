"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Button } from "@heroui/react";
import { useTranslations } from "next-intl";
import { bffFetch } from "@/lib/bffFetch";

type SpaceType = "personal" | "organization";
type PlanStatus = "active" | "coming_soon";
type PaymentMethod = "mock_card" | "mock_bank_transfer" | "mock_invoice";
type PaymentOutcome = "succeeded" | "pending" | "failed" | "cancelled";

type Plan = {
  id: string;
  spaceType: SpaceType;
  name: string;
  amountCents: number;
  currency: string;
  billingInterval: string;
  status: PlanStatus;
  quotas: {
    projects: number | null;
    storageGb: number | null;
    cpuHours: number | null;
    gpuHours: number | null;
    members?: number | null;
  };
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
  entitlements: Array<{ resource: string; limitValue: number | null; sourcePlan: string }>;
};

type Payment = {
  id: string;
  planId: string;
  amountCents: number;
  currency: string;
  paymentMethod: PaymentMethod;
  status: PaymentOutcome;
  failureCode: string | null;
  createdAt?: string;
};

type ErrorBody = { error?: string; message?: string };

const paymentMethods: PaymentMethod[] = ["mock_card", "mock_bank_transfer", "mock_invoice"];
const paymentOutcomes: PaymentOutcome[] = ["succeeded", "pending", "failed", "cancelled"];

export default function BillingPanel() {
  const t = useTranslations("account");
  const [plans, setPlans] = useState<Plan[]>([]);
  const [details, setDetails] = useState<Details | null>(null);
  const [payments, setPayments] = useState<Payment[]>([]);
  const [selectedPlanId, setSelectedPlanId] = useState("");
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>("mock_card");
  const [outcome, setOutcome] = useState<PaymentOutcome>("succeeded");
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const loadBilling = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [plansResponse, detailsResponse, paymentsResponse] = await Promise.all([
        bffFetch("/api/bff/subscriptions/plans", { cache: "no-store" }),
        bffFetch("/api/bff/subscription", { cache: "no-store" }),
        bffFetch("/api/bff/payments", { cache: "no-store" }),
      ]);
      if (!plansResponse.ok || !detailsResponse.ok || !paymentsResponse.ok) throw new Error("loadFailed");
      const planBody = await plansResponse.json() as { plans: Plan[] };
      const detailsBody = await detailsResponse.json() as Details;
      const paymentsBody = await paymentsResponse.json() as { payments: Payment[] };
      setPlans(planBody.plans);
      setDetails(detailsBody);
      setPayments(paymentsBody.payments);
      setSelectedPlanId((current) => current && planBody.plans.some((plan) => plan.id === current) ? current : planBody.plans.find((plan) => plan.status === "active")?.id ?? "");
    } catch {
      setError(t("billingLoadFailed"));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    const task = window.setTimeout(() => { void loadBilling(); }, 0);
    return () => window.clearTimeout(task);
  }, [loadBilling]);

  const selectedPlan = useMemo(() => plans.find((plan) => plan.id === selectedPlanId), [plans, selectedPlanId]);
  const visiblePlans = plans.filter((plan) => !details || plan.spaceType === details.spaceType);
  const activePlans = visiblePlans.filter((plan) => plan.status === "active");
  const upcomingPlans = visiblePlans.filter((plan) => plan.status === "coming_soon");

  const requestBilling = async (url: string, body: Record<string, unknown>) => {
    setPending(true);
    setError(null);
    setMessage(null);
    try {
      const response = await bffFetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!response.ok) {
        const responseBody = await response.json().catch(() => ({})) as ErrorBody;
        throw new Error(responseBody.error ?? "billingRequestFailed");
      }
      setMessage(t("billingUpdated"));
      await loadBilling();
    } catch (requestError) {
      const code = requestError instanceof Error ? requestError.message : "billingRequestFailed";
      setError(t(code === "PLAN_UNAVAILABLE" ? "planUnavailable" : code === "SPACE_PLAN_MISMATCH" ? "spacePlanMismatch" : code === "PAYMENT_NOT_RETRYABLE" ? "paymentNotRetryable" : "billingRequestFailed"));
    } finally {
      setPending(false);
    }
  };

  const checkout = async () => {
    if (!selectedPlan) return;
    await requestBilling("/api/bff/subscriptions/mock/checkout", {
      planId: selectedPlan.id,
      paymentMethod,
      mockOutcome: outcome,
      idempotencyKey: globalThis.crypto.randomUUID(),
    });
  };

  const retryPayment = async (payment: Payment) => {
    await requestBilling(`/api/bff/payments/mock/${encodeURIComponent(payment.id)}/retry`, {
      paymentMethod,
      mockOutcome: "succeeded",
      idempotencyKey: globalThis.crypto.randomUUID(),
    });
  };

  const cancelSubscription = async () => {
    await requestBilling("/api/bff/subscription/cancel", {});
  };

  const formatPrice = (plan: Plan) => plan.amountCents === 0
    ? t("billingFree")
    : new Intl.NumberFormat(undefined, { style: "currency", currency: plan.currency }).format(plan.amountCents / 100) + (plan.id === "org_growth" ? t("billingPerMember") : t("billingPerMonth"));

  const formatQuota = (value: number | null, unit: string) => value === null ? t("billingUnlimited") : `${value} ${unit}`;
  const statusLabel = (status: string) => t(`billingStatus${status.charAt(0).toUpperCase()}${status.slice(1)}` as "billingStatusActive");
  const methodLabel = (method: PaymentMethod) => t(`billingMethod${method === "mock_card" ? "Card" : method === "mock_bank_transfer" ? "BankTransfer" : "Invoice"}` as "billingMethodCard");
  const outcomeLabel = (value: PaymentOutcome) => t(`billingOutcome${value.charAt(0).toUpperCase()}${value.slice(1)}` as "billingOutcomeSucceeded");
  const quotaLabel = (resource: string) => {
    const labels: Record<string, "billingQuotaProjects" | "billingQuotaStorageGb" | "billingQuotaCpuHours" | "billingQuotaGpuHours" | "billingQuotaMembers"> = {
      projects: "billingQuotaProjects",
      storage_gb: "billingQuotaStorageGb",
      cpu_hours: "billingQuotaCpuHours",
      gpu_hours: "billingQuotaGpuHours",
      members: "billingQuotaMembers",
    };
    const key = labels[resource];
    return key ? t(key) : resource;
  };

  if (loading) {
    return <section className="panel"><p className="muted">{t("billingLoading")}</p></section>;
  }

  return (
    <div className="billing">
      <section className="notice" role="note">
        <div className="notice-head">
          <h2 className="panel-title">{t("billingHeading")}</h2>
          <span className="pill pill-warning">{t("billingBadge")}</span>
        </div>
        <p className="muted">{t("billingDisclaimer")}</p>
      </section>

      {error ? <p className="form-error" role="alert">{error}</p> : null}
      {message ? <p className="form-success" role="status">{message}</p> : null}

      <section className="panel">
        <div className="section-head">
          <div>
            <h2 className="panel-title">{t("currentSubscription")}</h2>
            <p className="muted">{details?.subscription ? details.subscription.plan : t("noSubscription")}</p>
          </div>
          {details?.subscription ? <span className="pill">{statusLabel(details.subscription.status)}</span> : null}
        </div>
        {details?.subscription && ["active", "pending", "past_due"].includes(details.subscription.status) ? <Button size="sm" variant="secondary" onPress={() => void cancelSubscription()} isPending={pending} isDisabled={pending}>{t("cancelSubscription")}</Button> : null}
        {details?.entitlements.length ? (
          <div className="stat-grid stat-grid-4">
            {details.entitlements.map((entitlement) => (
              <article className="stat" key={entitlement.resource}>
                <span className="muted small">{quotaLabel(entitlement.resource)}</span>
                <span className="stat-value small-value">{formatQuota(entitlement.limitValue, entitlement.resource === "storage_gb" ? t("billingGb") : entitlement.resource === "members" ? t("billingMembers") : t("billingHours"))}</span>
              </article>
            ))}
          </div>
        ) : null}
      </section>

      <section className="panel">
        <div className="stack-tight">
          <h2 className="panel-title">{t("choosePlan")}</h2>
          <p className="muted">{t("choosePlanBody")}</p>
        </div>
        <div className="plan-grid">
          {activePlans.map((plan) => (
            <button type="button" key={plan.id} className={`plan-option${selectedPlanId === plan.id ? " is-selected" : ""}`} onClick={() => setSelectedPlanId(plan.id)} aria-pressed={selectedPlanId === plan.id}>
              <span className="plan-name">{plan.name}</span>
              <span className="plan-price">{formatPrice(plan)}</span>
              <span className="plan-quotas muted small">
                <span>{formatQuota(plan.quotas.projects, t("billingProjects"))}</span>
                <span>{formatQuota(plan.quotas.storageGb, t("billingGb"))}</span>
                <span>{formatQuota(plan.quotas.cpuHours, t("billingHours"))}</span>
                <span>{formatQuota(plan.quotas.gpuHours, t("billingGpuHours"))}</span>
              </span>
            </button>
          ))}
        </div>
        {upcomingPlans.length ? (
          <div className="stack-tight">
            <p className="muted small">{t("comingSoon")}</p>
            <div className="chip-row">{upcomingPlans.map((plan) => <span className="pill" key={plan.id}>{plan.name} · {t("comingSoon")}</span>)}</div>
          </div>
        ) : null}
        <div className="checkout-row">
          <label className="field">{t("paymentMethodLabel")}<select value={paymentMethod} onChange={(event) => setPaymentMethod(event.target.value as PaymentMethod)}>{paymentMethods.map((method) => <option value={method} key={method}>{methodLabel(method)}</option>)}</select></label>
          <label className="field">{t("mockOutcomeLabel")}<select value={outcome} onChange={(event) => setOutcome(event.target.value as PaymentOutcome)}>{paymentOutcomes.map((value) => <option value={value} key={value}>{outcomeLabel(value)}</option>)}</select></label>
          <Button variant="primary" onPress={() => void checkout()} isPending={pending} isDisabled={pending || !selectedPlan}>{t("startMockCheckout")}</Button>
        </div>
      </section>

      <section className="panel">
        <div className="stack-tight">
          <h2 className="panel-title">{t("paymentHistory")}</h2>
          <p className="muted">{t("paymentHistoryBody")}</p>
        </div>
        {payments.length === 0 ? <p className="muted">{t("paymentHistoryEmpty")}</p> : (
          <ul className="artifact-list">
            {payments.map((payment) => (
              <li className="artifact-row" key={payment.id}>
                <div className="server-meta">
                  <span className="artifact-name">{payment.planId} · {outcomeLabel(payment.status)}</span>
                  <span className="muted small">{methodLabel(payment.paymentMethod)} · {payment.id}</span>
                </div>
                <span className="small">{new Intl.NumberFormat(undefined, { style: "currency", currency: payment.currency }).format(payment.amountCents / 100)}</span>
                {payment.status === "failed" ? <Button size="sm" variant="secondary" onPress={() => void retryPayment(payment)} isPending={pending} isDisabled={pending}>{t("retryPayment")}</Button> : <span />}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
