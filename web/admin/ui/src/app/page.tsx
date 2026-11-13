"use client";

import { Card } from "@heroui/react";
import { useTranslations } from "next-intl";
import DataTable from "@/components/DataTable";
import InstanceType from "@/components/InstanceType";
import PageHeading from "@/components/PageHeading";
import PageError from "@/components/PageState";
import RelativeTime from "@/components/RelativeTime";
import Section from "@/components/Section";
import StatCard from "@/components/StatCard";
import StatusChip from "@/components/StatusChip";
import { useApi } from "@/hooks/useApi";
import type { Overview } from "@/lib/types";

export default function OverviewPage() {
  const t = useTranslations("overview");
  const { data, error, loading, reload } = useApi<Overview>("/api/overview");

  return (
    <>
      <PageHeading eyebrow={t("eyebrow")} title={t("title")} subtitle={t("subtitle")} onRefresh={reload} loading={loading} />
      <div className="admin-stack">
        <PageError message={error} />

        <Section title={t("services")} result={data?.health}>
          {(targets) =>
            targets.length === 0 ? (
              <p className="text-sm" style={{ color: "var(--muted)" }}>
                {t("servicesEmpty")}
              </p>
            ) : (
              <div className="admin-stat-grid">
                {targets.map((target) => (
                  <Card key={target.name} variant="secondary" className="flex flex-col gap-2 p-4">
                    <span className="workspace-mono-label">{target.name}</span>
                    <StatusChip status={target.ok ? "ok" : "error"}>{target.ok ? t("healthy") : t("unhealthy")}</StatusChip>
                    <span className="text-xs" style={{ color: "var(--muted)" }}>
                      {target.ok ? `HTTP ${target.status} · ${target.latencyMs} ms` : target.error ?? `HTTP ${target.status}`}
                    </span>
                  </Card>
                ))}
              </div>
            )
          }
        </Section>

        <Section title={t("product")} result={data?.summary}>
          {(summary) => (
            <div className="admin-stat-grid">
              <StatCard label={t("users")} value={summary.users} />
              <StatCard label={t("spaces")} value={summary.spaces} hint={t("spacesHint", { count: summary.organizationSpaces })} />
              <StatCard label={t("projects")} value={summary.projects} />
              <StatCard label={t("openSessions")} value={summary.openSessions} />
              <StatCard label={t("units")} value={summary.unitsThisMonth} />
              <StatCard
                label={t("paidPlans")}
                value={Object.values(summary.plans).reduce((sum, count) => sum + count, 0)}
                hint={Object.entries(summary.plans).map(([plan, count]) => `${plan}: ${count}`).join(" · ") || undefined}
              />
            </div>
          )}
        </Section>

        <Section title={t("cluster")} result={data?.cluster}>
          {(cluster) => (
            <div className="flex flex-col gap-6">
              <div className="admin-stat-grid">
                <StatCard label={t("nodes")} value={`${cluster.nodes.filter((node) => node.ready).length}/${cluster.nodes.length}`} hint={t("nodesHint")} />
                <StatCard label={t("pods")} value={cluster.podCount} hint={Object.entries(cluster.podPhases).map(([phase, count]) => `${phase}: ${count}`).join(" · ")} />
                <StatCard label={t("gpus")} value={cluster.nodes.reduce((sum, node) => sum + node.gpu, 0)} hint={t("gpusHint")} />
                <StatCard label={t("problemPods")} value={cluster.problems.length} />
              </div>
              <DataTable
                label={t("nodeList")}
                rows={cluster.nodes}
                rowId={(node) => node.name}
                empty={t("nodesHint")}
                columns={[
                  { key: "node", header: t("colNode"), cell: (node) => <span className="admin-mono">{node.name}</span> },
                  { key: "state", header: t("colState"), cell: (node) => <StatusChip status={node.ready ? "ok" : "error"}>{node.ready ? t("ready") : t("notReady")}</StatusChip> },
                  { key: "type", header: t("colInstance"), cell: (node) => <InstanceType type={node.instanceType} /> },
                  { key: "pool", header: t("colPool"), cell: (node) => node.nodePool ?? "—" },
                  { key: "life", header: t("colLifecycle"), cell: (node) => node.capacityType ?? "—" },
                  { key: "zone", header: t("colZone"), cell: (node) => node.zone ?? "—" },
                  { key: "gpu", header: t("colGpu"), cell: (node) => node.gpu },
                ]}
              />
              {cluster.problems.length > 0 ? (
                <div className="flex flex-col gap-2">
                  <h3 className="workspace-mono-label">{t("problemList")}</h3>
                  <DataTable
                    label={t("problemList")}
                    rows={cluster.problems}
                    rowId={(pod) => `${pod.namespace}/${pod.name}`}
                    empty=""
                    columns={[
                      { key: "ns", header: t("colNamespace"), cell: (pod) => pod.namespace },
                      { key: "pod", header: t("colPod"), cell: (pod) => <span className="admin-mono">{pod.name}</span> },
                      { key: "reason", header: t("colReason"), cell: (pod) => <StatusChip status="warn">{pod.reason}</StatusChip> },
                      { key: "restarts", header: t("colRestarts"), cell: (pod) => pod.restarts },
                      { key: "node", header: t("colNode"), cell: (pod) => pod.node ?? "—" },
                    ]}
                  />
                </div>
              ) : null}
              {cluster.events.length > 0 ? (
                <div className="flex flex-col gap-2">
                  <h3 className="workspace-mono-label">{t("eventList")}</h3>
                  <DataTable
                    label={t("eventList")}
                    rows={cluster.events.slice(0, 10)}
                    rowId={(event, index) => `${event.namespace}/${event.object}/${event.reason}/${index}`}
                    empty=""
                    columns={[
                      { key: "when", header: t("colWhen"), cell: (event) => <RelativeTime value={event.at} /> },
                      { key: "object", header: t("colObject"), cell: (event) => <span className="admin-mono">{`${event.namespace}/${event.object}`}</span> },
                      { key: "reason", header: t("colReason"), cell: (event) => event.reason },
                      { key: "message", header: t("colMessage"), cell: (event) => event.message },
                    ]}
                  />
                </div>
              ) : null}
            </div>
          )}
        </Section>
      </div>
    </>
  );
}
