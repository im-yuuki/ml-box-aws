"use client";

import { useTranslations } from "next-intl";
import DataTable from "@/components/DataTable";
import PageHeading from "@/components/PageHeading";
import PageError from "@/components/PageState";
import Section from "@/components/Section";
import StatusChip from "@/components/StatusChip";
import { useApi } from "@/hooks/useApi";
import { shortImage } from "@/lib/format";
import type { DeploymentsResponse } from "@/lib/types";

export default function DeploymentsPage() {
  const t = useTranslations("deployments");
  const { data, error, loading, reload } = useApi<DeploymentsResponse>("/api/deployments");

  return (
    <>
      <PageHeading eyebrow={t("eyebrow")} title={t("title")} subtitle={t("subtitle")} onRefresh={reload} loading={loading} />
      <div className="admin-stack">
        <PageError message={error} />

        <Section title={t("workloads")} result={data?.workloads}>
          {(workloads) => (
            <DataTable
              label={t("workloads")}
              rows={workloads}
              rowId={(workload) => `${workload.namespace}/${workload.kind}/${workload.name}`}
              empty={t("workloadsEmpty")}
              columns={[
                { key: "ns", header: t("colNamespace"), cell: (workload) => workload.namespace },
                { key: "name", header: t("colName"), cell: (workload) => <span className="admin-mono">{workload.name}</span> },
                { key: "kind", header: t("colKind"), cell: (workload) => workload.kind },
                {
                  key: "ready",
                  header: t("colReady"),
                  cell: (workload) => (
                    <StatusChip status={workload.desired === 0 ? "info" : workload.ready >= workload.desired ? "ok" : "warn"}>{`${workload.ready}/${workload.desired}`}</StatusChip>
                  ),
                },
                {
                  key: "image",
                  header: t("colImage"),
                  cell: (workload) => (
                    <div className="flex flex-col">
                      {workload.images.map((image) => (
                        <span key={image} className="admin-mono" title={image}>
                          {shortImage(image)}
                        </span>
                      ))}
                    </div>
                  ),
                },
              ]}
            />
          )}
        </Section>

        <Section title={t("volumes")} result={data?.volumes}>
          {(volumes) => (
            <DataTable
              label={t("volumes")}
              rows={volumes}
              rowId={(volume) => `${volume.namespace}/${volume.name}`}
              empty={t("volumesEmpty")}
              columns={[
                { key: "ns", header: t("colNamespace"), cell: (volume) => volume.namespace },
                { key: "name", header: t("colName"), cell: (volume) => <span className="admin-mono">{volume.name}</span> },
                { key: "status", header: t("colStatus"), cell: (volume) => <StatusChip status={volume.phase === "Bound" ? "ok" : "warn"}>{volume.phase}</StatusChip> },
                { key: "size", header: t("colSize"), cell: (volume) => volume.size ?? "—" },
                { key: "class", header: t("colClass"), cell: (volume) => volume.storageClass ?? "—" },
              ]}
            />
          )}
        </Section>
      </div>
    </>
  );
}
