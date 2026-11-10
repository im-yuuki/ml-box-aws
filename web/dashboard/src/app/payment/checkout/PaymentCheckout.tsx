"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Button, Card } from "@heroui/react";
import { CheckCircle2, XCircle } from "lucide-react";
import { useTranslations } from "next-intl";
import { bffFetch } from "@/lib/bffFetch";
import FeedbackAlert from "@/components/FeedbackAlert";
import BrandMark from "@/components/BrandMark";

type Plan = { id: string; name: string; amountCents: number; currency: string };
type Payment = {
  id: string;
  planId: string;
  amountCents: number;
  currency: string;
};
type Outcome = "succeeded" | "failed";

/**
 * Payment provider page. Reached only from the subscription page: it shows the
 * order and returns the customer with the payment result.
 */
export default function PaymentCheckout() {
  const t = useTranslations("checkout");
  const router = useRouter();
  const params = useSearchParams();
  const planId = params.get("plan");
  const paymentId = params.get("payment");
  const [order, setOrder] = useState<{
    title: string;
    amountCents: number;
    currency: string;
  } | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const task = window.setTimeout(async () => {
      try {
        if (planId) {
          const response = await bffFetch("/api/bff/subscriptions/plans", {
            cache: "no-store",
          });
          if (!response.ok) throw new Error("load");
          const body = (await response.json()) as { plans: Plan[] };
          const plan = body.plans.find((item) => item.id === planId);
          if (!plan) throw new Error("load");
          setOrder({
            title: plan.name,
            amountCents: plan.amountCents,
            currency: plan.currency,
          });
        } else if (paymentId) {
          const response = await bffFetch("/api/bff/payments", {
            cache: "no-store",
          });
          if (!response.ok) throw new Error("load");
          const body = (await response.json()) as { payments: Payment[] };
          const payment = body.payments.find((item) => item.id === paymentId);
          if (!payment) throw new Error("load");
          setOrder({
            title: payment.planId,
            amountCents: payment.amountCents,
            currency: payment.currency,
          });
        } else {
          throw new Error("load");
        }
      } catch {
        setLoadError(true);
      }
    }, 0);
    return () => window.clearTimeout(task);
  }, [planId, paymentId]);

  const pay = async (outcome: Outcome) => {
    setBusy(true);
    setError(null);
    try {
      const body = {
        paymentMethod: "mock_card",
        mockOutcome: outcome,
        idempotencyKey: globalThis.crypto.randomUUID(),
      };
      const response = planId
        ? await bffFetch("/api/bff/subscriptions/mock/checkout", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ planId, ...body }),
          })
        : await bffFetch(
            `/api/bff/payments/mock/${encodeURIComponent(paymentId ?? "")}/retry`,
            {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify(body),
            },
          );
      if (!response.ok) throw new Error("request");
      router.replace(`/subscription?result=${outcome}`);
    } catch {
      setError(t("requestFailed"));
    } finally {
      setBusy(false);
    }
  };

  const amount = order
    ? new Intl.NumberFormat(undefined, {
        style: "currency",
        currency: order.currency,
      }).format(order.amountCents / 100)
    : "";

  return (
    <div className="public-frame">
      <header className="public-header">
        <span className="workspace-brand" aria-hidden="true">
          <BrandMark />
          <span className="workspace-brand-copy">
            <strong>MLBox</strong>
          </span>
        </span>
      </header>
      <main className="public-main">
        <Card className="mx-auto w-full max-w-md">
          <Card.Header>
            <Card.Title>{t("title")}</Card.Title>
          </Card.Header>
          <Card.Content className="flex flex-col gap-5">
            {loadError ? (
              <FeedbackAlert status="danger">{t("loadFailed")}</FeedbackAlert>
            ) : !order ? (
              <p
                className="text-sm"
                style={{ color: "var(--muted)" }}
                role="status">
                {t("loading")}
              </p>
            ) : (
              <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-3 text-sm">
                <dt style={{ color: "var(--muted)" }}>{t("plan")}</dt>
                <dd className="font-medium">{order.title}</dd>
                <dt style={{ color: "var(--muted)" }}>{t("amount")}</dt>
                <dd className="font-medium">{amount}</dd>
              </dl>
            )}

            {order ? (
              <>
                <p className="text-sm font-medium">{t("chooseResult")}</p>
                <div className="flex flex-col gap-2">
                  <Button
                    variant="primary"
                    onPress={() => void pay("succeeded")}
                    isPending={busy}
                    isDisabled={busy}
                    fullWidth>
                    <CheckCircle2 aria-hidden="true" size={16} />
                    {t("succeeded")}
                  </Button>
                  <Button
                    variant="secondary"
                    onPress={() => void pay("failed")}
                    isDisabled={busy}
                    fullWidth>
                    <XCircle aria-hidden="true" size={16} />
                    {t("failed")}
                  </Button>
                </div>
              </>
            ) : null}

            {error ? (
              <FeedbackAlert status="danger">{error}</FeedbackAlert>
            ) : null}

            <Link
              href="/subscription"
              className="text-center text-sm"
              style={{ color: "var(--muted)" }}>
              {t("back")}
            </Link>
          </Card.Content>
        </Card>
      </main>
    </div>
  );
}
