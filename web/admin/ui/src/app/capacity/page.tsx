"use client";

import { Card } from "@heroui/react";
import { useTranslations } from "next-intl";
import CardSectionTitle from "@/components/CardSectionTitle";
import DataTable from "@/components/DataTable";
import InstanceType from "@/components/InstanceType";
import PageHeading from "@/components/PageHeading";
import PageError from "@/components/PageState";
import Section from "@/components/Section";
import StatusChip from "@/components/StatusChip";
import UsageBar from "@/components/UsageBar";
import { useApi } from "@/hooks/useApi";
import type { CapacityResponse, VcpuQuota } from "@/lib/types";

function QuotaCard({ quota }: { quota: VcpuQuota }) {
  const t = useTranslations("capacity");
  const name = t(`quotaNames.${quota.family}-${quota.lifecycle}` as "quotaNames.gvt-on-demand");
  return (
    <Card variant="secondary" className="flex flex-col gap-2 p-4">
      <span className="workspace-mono-label">{name}</span>
      <span className="text-2xl font-semibold tabular-nums">{quota.limit === null ? quota.used : `${quota.used}/${quota.limit}`}</span>
      <UsageBar used={quota.used} limit={quota.limit} label={name} />
      <span className="text-xs" style={{ color: "var(--muted)" }}>
        {quota.limit === null ? t("quotaUnknown", { used: quota.used }) : t("quotaUsed", { used: quota.used, limit: quota.limit })}
      </span>
      {quota.level === "error" && quota.limit !== null ? <StatusChip status="error">{t("quotaFull")}</StatusChip> : null}
    </Card>
  );
}

export default function CapacityPage() {
  const t = useTranslations("capacity");
  const { data, error, loading, reload } = useApi<CapacityResponse>("/api/capacity");

  return (
    <>
      <PageHeading eyebrow={t("eyebrow")} title={t("title")} subtitle={t("subtitle")} onRefresh={reload} loading={loading} />
      <div className="admin-stack">
        <PageError message={error} />

        <Section title={t("quotas")} result={data?.quotas}>
          {(quotas) => <div className="admin-stat-grid">{quotas.map((quota) => <QuotaCard key={quota.code} quota={quota} />)}</div>}
        </Section>

        <Section title={t("gpuNodes")} result={data?.capacity}>
          {(capacity) =>
            capacity.gpuNodes.length === 0 ? (
              <p className="text-sm" style={{ color: "var(--muted)" }}>
                {t("gpuNodesEmpty")}
              </p>
            ) : (
              <div className="admin-resource-grid">
                {capacity.gpuNodes.map((node) => (
                  <Card key={node.name} variant="secondary" className="flex flex-col gap-3 p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <InstanceType type={node.instanceType} />
                        <CardSectionTitle className="admin-mono break-all text-sm">{node.name}</CardSectionTitle>
                      </div>
                      <StatusChip status={node.requested >= node.allocatable ? "warn" : "ok"}>{`${node.requested}/${node.allocatable}`}</StatusChip>
                    </div>
                    <UsageBar used={node.requested} limit={node.allocatable} label={node.name} />
                    <span className="text-xs" style={{ color: "var(--muted)" }}>
                      {t("gpuUsed", { requested: node.requested, total: node.allocatable })}
                      {node.nodePool ? ` · ${node.nodePool}` : ""}
                      {node.zone ? ` · ${node.zone}` : ""}
                    </span>
                    {node.pods.length > 0 ? (
                      <dl className="admin-kv">
                        {node.pods.flatMap((pod) => [
                          <dt key={`${pod.name}-k`}>{pod.gpu} GPU</dt>,
                          <dd key={`${pod.name}-v`} className="admin-mono">{`${pod.namespace}/${pod.name}`}</dd>,
                        ])}
                      </dl>
                    ) : null}
                  </Card>
                ))}
              </div>
            )
          }
        </Section>

        <Section title={t("pending")} result={data?.capacity}>
          {(capacity) => (
            <DataTable
              label={t("pending")}
              rows={capacity.pending}
              rowId={(pod) => `${pod.namespace}/${pod.name}`}
              empty={t("pendingEmpty")}
              columns={[
                { key: "ns", header: t("colNamespace"), cell: (pod) => pod.namespace },
                { key: "pod", header: t("colPod"), cell: (pod) => <span className="admin-mono">{pod.name}</span> },
                { key: "gpu", header: t("colGpu"), cell: (pod) => pod.gpu },
                { key: "reason", header: t("colReason"), cell: (pod) => <StatusChip status="warn">{pod.reason}</StatusChip> },
                { key: "message", header: t("colMessage"), cell: (pod) => pod.message },
                { key: "age", header: t("colWaiting"), cell: (pod) => (pod.ageMinutes === null ? "—" : t("minutes", { count: pod.ageMinutes })) },
              ]}
            />
          )}
        </Section>

        <Section title={t("nodeClaims")} result={data?.capacity}>
          {(capacity) => (
            <DataTable
              label={t("nodeClaims")}
              rows={capacity.nodeClaims}
              rowId={(claim) => claim.name}
              empty={t("nodeClaimsEmpty")}
              columns={[
                { key: "name", header: t("colName"), cell: (claim) => <span className="admin-mono">{claim.name}</span> },
                { key: "pool", header: t("colPool"), cell: (claim) => claim.nodePool ?? "—" },
                { key: "type", header: t("colInstance"), cell: (claim) => <InstanceType type={claim.instanceType} /> },
                { key: "stage", header: t("colStage"), cell: (claim) => <StatusChip status={claim.ready ? "ok" : "warn"}>{claim.stage}</StatusChip> },
                { key: "message", header: t("colMessage"), cell: (claim) => claim.message },
                { key: "age", header: t("colAge"), cell: (claim) => (claim.ageMinutes === null ? "—" : t("minutes", { count: claim.ageMinutes })) },
              ]}
            />
          )}
        </Section>

        <Section title={t("nodePools")} result={data?.capacity}>
          {(capacity) => (
            <DataTable
              label={t("nodePools")}
              rows={capacity.nodePools}
              rowId={(pool) => pool.name}
              empty={t("nodePoolsEmpty")}
              columns={[
                { key: "pool", header: t("colPool"), cell: (pool) => pool.name },
                { key: "ready", header: t("colReady"), cell: (pool) => <StatusChip status={pool.ready === false ? "error" : pool.ready ? "ok" : "info"}>{pool.ready ? t("ready") : pool.ready === false ? t("notReady") : "—"}</StatusChip> },
                { key: "nodes", header: t("colNodes"), cell: (pool) => pool.nodes ?? "—" },
                { key: "cpu", header: t("colCpu"), cell: (pool) => (pool.limits.cpu ? `${pool.cpu ?? "0"} / ${pool.limits.cpu}` : pool.cpu ?? "—") },
                { key: "gpu", header: t("colGpu"), cell: (pool) => (pool.limits.gpu ? `${pool.gpu ?? "0"} / ${pool.limits.gpu}` : pool.gpu ?? t("unlimited")) },
              ]}
            />
          )}
        </Section>
      </div>
    </>
  );
}
