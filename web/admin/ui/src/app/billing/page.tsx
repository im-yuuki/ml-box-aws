"use client";

import { useTranslations } from "next-intl";
import ChangePlanButton from "@/components/ChangePlanButton";
import DataTable from "@/components/DataTable";
import DateTime from "@/components/DateTime";
import PageHeading from "@/components/PageHeading";
import PageError from "@/components/PageState";
import Section from "@/components/Section";
import StatCard from "@/components/StatCard";
import StatusChip from "@/components/StatusChip";
import UsageBar from "@/components/UsageBar";
import { useActionsEnabled } from "@/components/ActionButton";
import { useApi } from "@/hooks/useApi";
import { usageStatus } from "@/lib/format";
import type { BillingResponse } from "@/lib/types";

const SUBSCRIPTION_STATUS: Record<string, "ok" | "warn" | "error" | "info"> = { active: "ok", pending: "warn", past_due: "error", cancelled: "info", inactive: "info" };

export default function BillingPage() {
  const t = useTranslations("billing");
  const common = useTranslations("common");
  const plans = useTranslations("billing.plans");
  const actions = useActionsEnabled();
  const { data, error, loading, reload } = useApi<BillingResponse>("/api/billing");
  const planName = (id: string) => (plans.has(id) ? plans(id as "personal_free") : id);
  const money = (cents: number, currency: string) => new Intl.NumberFormat(undefined, { style: "currency", currency }).format(cents / 100);

  return (
    <>
      <PageHeading eyebrow={t("eyebrow")} title={t("title")} subtitle={t("subtitle")} onRefresh={reload} loading={loading} />
      <div className="admin-stack">
        <PageError message={error} />

        <Section title={t("spaces")} result={data?.spaces}>
          {(spaces) => {
            const attention = spaces.filter((space) => space.status === "past_due" || space.status === "pending").length;
            const over = spaces.filter((space) => usageStatus(space.units_this_month, space.limit) !== "ok" && space.limit !== null).length;
            return (
              <div className="flex flex-col gap-6">
                <div className="admin-stat-grid">
                  <StatCard label={t("stats.spaces")} value={spaces.length} />
                  <StatCard label={t("stats.active")} value={spaces.filter((space) => space.status === "active").length} />
                  <StatCard label={t("stats.attention")} value={attention} />
                  <StatCard label={t("stats.free")} value={spaces.filter((space) => space.effectivePlan === "personal_free").length} />
                  <StatCard label={t("stats.overQuota")} value={over} />
                </div>
                <DataTable
                  label={t("spaces")}
                  rows={spaces}
                  rowId={(space) => space.id}
                  empty={t("spacesEmpty")}
                  columns={[
                    {
                      key: "space",
                      header: t("colSpace"),
                      cell: (space) => (
                        <div className="flex flex-col">
                          <span>{space.name}</span>
                          <span className="text-xs" style={{ color: "var(--muted)" }}>{space.type === "organization" ? common("organization") : common("personal")}</span>
                        </div>
                      ),
                    },
                    { key: "owner", header: t("colOwner"), cell: (space) => space.owner_email ?? "—" },
                    { key: "plan", header: t("colPlan"), cell: (space) => planName(space.effectivePlan) },
                    {
                      key: "status",
                      header: t("colStatus"),
                      cell: (space) => (space.status ? <StatusChip status={SUBSCRIPTION_STATUS[space.status] ?? "info"}>{space.status}</StatusChip> : t("noSubscription")),
                    },
                    {
                      key: "units",
                      header: t("colUnits"),
                      cell: (space) => (
                        <div className="flex min-w-40 flex-col gap-1">
                          <span className="text-xs">{space.limit === null ? space.units_this_month : t("unitsOfLimit", { used: space.units_this_month, limit: space.limit })}</span>
                          <UsageBar used={space.units_this_month} limit={space.limit} label={space.name} />
                        </div>
                      ),
                    },
                    { key: "renews", header: t("colRenews"), cell: (space) => <DateTime value={space.current_period_end} /> },
                    ...(actions
                      ? [
                          {
                            key: "actions",
                            header: t("colActions"),
                            cell: (space: (typeof spaces)[number]) => <ChangePlanButton spaceId={space.id} spaceName={space.name} currentPlan={space.effectivePlan} plans={space.alternatives} onDone={reload} />,
                          },
                        ]
                      : []),
                  ]}
                />
              </div>
            );
          }}
        </Section>

        <Section title={t("payments")} result={data?.payments}>
          {(payments) => (
            <DataTable
              label={t("payments")}
              rows={payments}
              rowId={(payment) => payment.id}
              empty={t("paymentsEmpty")}
              columns={[
                { key: "when", header: t("colWhen"), cell: (payment) => <DateTime value={payment.created_at} /> },
                { key: "space", header: t("colSpace"), cell: (payment) => payment.space_name },
                { key: "plan", header: t("colPlan"), cell: (payment) => planName(payment.plan_id) },
                { key: "amount", header: t("colAmount"), cell: (payment) => money(payment.amount_cents, payment.currency) },
                { key: "method", header: t("colMethod"), cell: (payment) => payment.payment_method },
                {
                  key: "status",
                  header: t("colStatus"),
                  cell: (payment) => <StatusChip status={payment.status === "succeeded" ? "ok" : payment.status === "failed" ? "error" : "warn"}>{payment.status}</StatusChip>,
                },
                { key: "failure", header: t("colReason"), cell: (payment) => payment.failure_code ?? "—" },
              ]}
            />
          )}
        </Section>
      </div>
    </>
  );
}
