"use client";

import { useTranslations } from "next-intl";
import DataTable from "@/components/DataTable";
import PageHeading from "@/components/PageHeading";
import PageError from "@/components/PageState";
import Section from "@/components/Section";
import StatusChip from "@/components/StatusChip";
import UsageBar from "@/components/UsageBar";
import { useApi } from "@/hooks/useApi";
import { formatBytes } from "@/lib/format";
import type { ClaimStatus, StorageResponse } from "@/lib/types";

const CLAIM_STATUS: Record<ClaimStatus, "ok" | "warn" | "error"> = { ok: "ok", deletedProject: "warn", unknownProject: "error", unlabelled: "warn" };

export default function StoragePage() {
  const t = useTranslations("storage");
  const common = useTranslations("common");
  const { data, error, loading, reload } = useApi<StorageResponse>("/api/storage");

  return (
    <>
      <PageHeading eyebrow={t("eyebrow")} title={t("title")} subtitle={t("subtitle")} onRefresh={reload} loading={loading} />
      <div className="admin-stack">
        <PageError message={error} />

        <Section title={t("spaces")} result={data?.spaces}>
          {(spaces) => (
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
                { key: "plan", header: t("colPlan"), cell: (space) => space.plan },
                {
                  key: "used",
                  header: t("colUsed"),
                  cell: (space) => (
                    <div className="flex min-w-48 flex-col gap-1">
                      <span className="text-xs">{space.limitGb === null ? t("noLimit", { used: formatBytes(space.bytes) }) : t("usedOfLimit", { used: formatBytes(space.bytes), limit: space.limitGb })}</span>
                      <UsageBar used={space.bytes} limit={space.limitGb === null ? null : space.limitGb * 1024 ** 3} label={space.name} />
                    </div>
                  ),
                },
              ]}
            />
          )}
        </Section>

        <Section title={t("volumes")} result={data?.volumes}>
          {(volumes) => {
            const leftovers = volumes.filter((volume) => volume.status !== "ok").length;
            return (
              <div className="flex flex-col gap-3">
                <p className="text-xs" style={{ color: "var(--muted)" }}>
                  {t("volumesNote")}
                </p>
                {leftovers > 0 ? <StatusChip status="warn">{t("leftovers", { count: leftovers })}</StatusChip> : null}
                <DataTable
                  label={t("volumes")}
                  rows={volumes}
                  rowId={(volume) => `${volume.namespace}/${volume.name}`}
                  empty={t("volumesEmpty")}
                  columns={[
                    { key: "claim", header: t("colClaim"), cell: (volume) => <span className="admin-mono break-all">{volume.name}</span> },
                    {
                      key: "project",
                      header: t("colProject"),
                      cell: (volume) =>
                        volume.project ? (
                          <div className="flex flex-col">
                            <span>{volume.project.name}</span>
                            <span className="text-xs" style={{ color: "var(--muted)" }}>{volume.project.spaceName}</span>
                          </div>
                        ) : (
                          <span className="admin-mono">{volume.serverName ?? "—"}</span>
                        ),
                    },
                    { key: "size", header: t("colSize"), cell: (volume) => volume.size ?? "—" },
                    { key: "phase", header: t("colPhase"), cell: (volume) => <StatusChip status={volume.phase === "Bound" ? "ok" : "warn"}>{volume.phase}</StatusChip> },
                    { key: "status", header: t("colStatus"), cell: (volume) => <StatusChip status={CLAIM_STATUS[volume.status]}>{t(`claimStatus.${volume.status}`)}</StatusChip> },
                  ]}
                />
              </div>
            );
          }}
        </Section>

        <Section title={t("projects")} result={data?.projects}>
          {(projects) => (
            <DataTable
              label={t("projects")}
              rows={projects}
              rowId={(project) => project.project_id}
              empty={t("projectsEmpty")}
              columns={[
                {
                  key: "project",
                  header: t("colProject"),
                  cell: (project) => (
                    <div className="flex flex-col">
                      <span>{project.project_name}</span>
                      {project.project_deleted_at ? <span className="text-xs" style={{ color: "var(--muted)" }}>{t("deletedProject")}</span> : null}
                    </div>
                  ),
                },
                { key: "space", header: t("colSpace"), cell: (project) => project.space_name },
                { key: "files", header: t("colFiles"), cell: (project) => project.ready_count },
                { key: "size", header: t("colSize"), cell: (project) => formatBytes(Number(project.ready_bytes)) },
                { key: "pending", header: t("colPending"), cell: (project) => project.pending_count },
                { key: "stuck", header: t("colStuck"), cell: (project) => (Number(project.stuck_count) > 0 ? <StatusChip status="warn">{project.stuck_count}</StatusChip> : "0") },
              ]}
            />
          )}
        </Section>
      </div>
    </>
  );
}
