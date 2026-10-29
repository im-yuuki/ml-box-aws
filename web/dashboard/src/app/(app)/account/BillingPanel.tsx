"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Button, Card } from "@heroui/react";
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

  if (loading) {
    return <Card className="p-5"><p className="text-sm" style={{ color: "var(--muted)" }}>{t("billingLoading")}</p></Card>;
  }

  return (
    <div className="flex flex-col gap-6">
      <Card className="flex flex-col gap-3 border p-5" style={{ borderColor: "var(--warning)" }}>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-base font-medium">{t("billingHeading")}</h2>
          <span className="rounded-full px-3 py-1 text-xs font-medium" style={{ background: "var(--warning)", color: "var(--foreground)" }}>{t("billingBadge")}</span>
        </div>
        <p className="text-sm" style={{ color: "var(--muted)" }}>{t("billingDisclaimer")}</p>
      </Card>

      {error ? <p className="text-sm" role="alert" style={{ color: "var(--danger)" }}>{error}</p> : null}
      {message ? <p className="text-sm" role="status" style={{ color: "var(--success)" }}>{message}</p> : null}

      <Card className="flex flex-col gap-4 p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-base font-medium">{t("currentSubscription")}</h2>
            <p className="text-sm" style={{ color: "var(--muted)" }}>{details?.subscription ? details.subscription.plan : t("noSubscription")}</p>
          </div>
          {details?.subscription ? <span className="rounded-full border px-3 py-1 text-xs" style={{ borderColor: "var(--border)" }}>{statusLabel(details.subscription.status)}</span> : null}
        </div>
        {details?.subscription && ["active", "pending", "past_due"].includes(details.subscription.status) ? <Button size="sm" variant="secondary" onPress={() => void cancelSubscription()} isPending={pending} isDisabled={pending}>{t("cancelSubscription")}</Button> : null}
        {details?.entitlements.length ? <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">{details.entitlements.map((entitlement) => <div className="rounded-md border p-3" style={{ borderColor: "var(--border)" }} key={entitlement.resource}><p className="text-xs uppercase tracking-wide" style={{ color: "var(--muted)" }}>{t(`billingQuota${entitlement.resource}` as "billingQuotaProjects")}</p><p className="text-sm font-medium">{formatQuota(entitlement.limitValue, entitlement.resource === "storage_gb" ? t("billingGb") : entitlement.resource === "members" ? t("billingMembers") : t("billingHours"))}</p></div>)}</div> : null}
      </Card>

      <Card className="flex flex-col gap-4 p-5">
        <div>
          <h2 className="text-base font-medium">{t("choosePlan")}</h2>
          <p className="text-sm" style={{ color: "var(--muted)" }}>{t("choosePlanBody")}</p>
        </div>
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {activePlans.map((plan) => <button className="flex flex-col gap-3 rounded-lg border p-4 text-left transition hover:border-[var(--primary)]" style={{ borderColor: selectedPlanId === plan.id ? "var(--primary)" : "var(--border)", background: "var(--surface)" }} type="button" key={plan.id} onClick={() => setSelectedPlanId(plan.id)} aria-pressed={selectedPlanId === plan.id}>
            <div className="flex items-start justify-between gap-2"><span className="font-medium">{plan.name}</span><span className="text-sm">{formatPrice(plan)}</span></div>
            <div className="grid grid-cols-2 gap-1 text-xs" style={{ color: "var(--muted)" }}><span>{formatQuota(plan.quotas.projects, t("billingProjects"))}</span><span>{formatQuota(plan.quotas.storageGb, t("billingGb"))}</span><span>{formatQuota(plan.quotas.cpuHours, t("billingHours"))}</span><span>{formatQuota(plan.quotas.gpuHours, t("billingGpuHours"))}</span></div>
          </button>)}
        </div>
        {upcomingPlans.length ? <div><p className="mb-2 text-xs font-medium uppercase tracking-wide" style={{ color: "var(--muted)" }}>{t("comingSoon")}</p><div className="flex flex-wrap gap-2">{upcomingPlans.map((plan) => <span className="rounded-full border px-3 py-1 text-xs" style={{ borderColor: "var(--border)", color: "var(--muted)" }} key={plan.id}>{plan.name} · {t("comingSoon")}</span>)}</div></div> : null}
        <div className="grid gap-4 md:grid-cols-3">
          <label className="flex flex-col gap-1 text-sm">{t("paymentMethodLabel")}<select className="rounded-md border px-3 py-2" style={{ borderColor: "var(--border)", background: "var(--surface)" }} value={paymentMethod} onChange={(event) => setPaymentMethod(event.target.value as PaymentMethod)}>{paymentMethods.map((method) => <option value={method} key={method}>{methodLabel(method)}</option>)}</select></label>
          <label className="flex flex-col gap-1 text-sm">{t("mockOutcomeLabel")}<select className="rounded-md border px-3 py-2" style={{ borderColor: "var(--border)", background: "var(--surface)" }} value={outcome} onChange={(event) => setOutcome(event.target.value as PaymentOutcome)}>{paymentOutcomes.map((value) => <option value={value} key={value}>{outcomeLabel(value)}</option>)}</select></label>
          <div className="flex items-end"><Button className="w-full" variant="primary" onPress={() => void checkout()} isPending={pending} isDisabled={pending || !selectedPlan}>{t("startMockCheckout")}</Button></div>
        </div>
      </Card>

      <Card className="flex flex-col gap-4 p-5">
        <div><h2 className="text-base font-medium">{t("paymentHistory")}</h2><p className="text-sm" style={{ color: "var(--muted)" }}>{t("paymentHistoryBody")}</p></div>
        {payments.length === 0 ? <p className="text-sm" style={{ color: "var(--muted)" }}>{t("paymentHistoryEmpty")}</p> : <div className="flex flex-col gap-3">{payments.map((payment) => <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border p-3" style={{ borderColor: "var(--border)" }} key={payment.id}><div><p className="text-sm font-medium">{payment.planId} · {outcomeLabel(payment.status)}</p><p className="text-xs" style={{ color: "var(--muted)" }}>{methodLabel(payment.paymentMethod)} · {payment.id}</p></div><div className="flex items-center gap-3"><span className="text-sm">{new Intl.NumberFormat(undefined, { style: "currency", currency: payment.currency }).format(payment.amountCents / 100)}</span>{payment.status === "failed" ? <Button size="sm" variant="secondary" onPress={() => void retryPayment(payment)} isPending={pending} isDisabled={pending}>{t("retryPayment")}</Button> : null}</div></div>)}</div>}
      </Card>
    </div>
  );
}
