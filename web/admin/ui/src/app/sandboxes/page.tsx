"use client";

import { useTranslations } from "next-intl";
import ActionButton, { useActionsEnabled } from "@/components/ActionButton";
import DataTable from "@/components/DataTable";
import DateTime from "@/components/DateTime";
import InstanceType from "@/components/InstanceType";
import PageHeading from "@/components/PageHeading";
import PageError from "@/components/PageState";
import Section from "@/components/Section";
import StatusChip from "@/components/StatusChip";
import { useApi } from "@/hooks/useApi";
import { useRelativeText } from "@/hooks/useRelativeText";
import { sendAction } from "@/lib/actions";
import { formatDuration, sandboxStateStatus } from "@/lib/format";
import type { SandboxesResponse } from "@/lib/types";

const LONG_RUNNING_SECONDS = 20 * 3600;

/** A sandbox whose session is open: it is spending compute units right now. */
function MeteringChip({ startedAt }: { startedAt: string }) {
  const t = useTranslations("sandboxes");
  const since = useRelativeText(startedAt);
  return <StatusChip status="ok">{t("metering", { time: since ?? "" })}</StatusChip>;
}

export default function SandboxesPage() {
  const t = useTranslations("sandboxes");
  const common = useTranslations("common");
  const stop = useTranslations("actions.stopSandbox");
  const actions = useActionsEnabled();
  const { data, error, loading, reload } = useApi<SandboxesResponse>("/api/sandboxes");

  return (
    <>
      <PageHeading eyebrow={t("eyebrow")} title={t("title")} subtitle={t("subtitle")} onRefresh={reload} loading={loading} />
      <div className="admin-stack">
        <PageError message={error} />

        <Section title={t("openSessions")} result={data?.sessions}>
          {(sessions) => (
            <DataTable
              label={t("openSessions")}
              rows={sessions}
              rowId={(session) => session.id}
              empty={t("openSessionsEmpty")}
              columns={[
                { key: "project", header: t("colProject"), cell: (session) => session.project_name },
                { key: "space", header: t("colSpace"), cell: (session) => session.space_name },
                { key: "by", header: t("colStartedBy"), cell: (session) => session.started_by },
                { key: "started", header: t("colStarted"), cell: (session) => <DateTime value={session.started_at} /> },
                {
                  key: "age",
                  header: t("colRunning"),
                  cell: (session) => {
                    const seconds = Number(session.age_seconds);
                    const { hours, minutes } = formatDuration(seconds);
                    const text = t("duration", { hours, minutes });
                    return seconds > LONG_RUNNING_SECONDS ? <StatusChip status="warn">{`${text} · ${t("longRunning")}`}</StatusChip> : text;
                  },
                },
                { key: "units", header: t("colUnits"), cell: (session) => Number(session.units_per_hour) },
              ]}
            />
          )}
        </Section>

        <Section title={t("all")} result={data?.sandboxes}>
          {(sandboxes) => (
            <DataTable
              label={t("all")}
              rows={sandboxes}
              rowId={(sandbox) => sandbox.id}
              empty={t("allEmpty")}
              columns={[
                {
                  key: "project",
                  header: t("colProject"),
                  cell: (sandbox) => (
                    <div className="flex flex-col">
                      <span>{sandbox.project_name}</span>
                      {sandbox.deleted_at ? <span className="text-xs" style={{ color: "var(--muted)" }}>{common("deleted")}</span> : null}
                    </div>
                  ),
                },
                {
                  key: "space",
                  header: t("colSpace"),
                  cell: (sandbox) => (
                    <div className="flex flex-col">
                      <span>{sandbox.space_name}</span>
                      <span className="text-xs" style={{ color: "var(--muted)" }}>{sandbox.space_type === "organization" ? common("organization") : common("personal")}</span>
                    </div>
                  ),
                },
                { key: "owner", header: t("colOwner"), cell: (sandbox) => sandbox.owner_email },
                { key: "profile", header: t("colProfile"), cell: (sandbox) => <InstanceType type={sandbox.profile} /> },
                { key: "state", header: t("colState"), cell: (sandbox) => <StatusChip status={sandboxStateStatus(sandbox.state)}>{sandbox.state}</StatusChip> },
                {
                  key: "metering",
                  header: t("colMetering"),
                  cell: (sandbox) =>
                    sandbox.session_started_at ? (
                      <MeteringChip startedAt={sandbox.session_started_at} />
                    ) : (
                      common("none")
                    ),
                },
                { key: "hub", header: t("colHubUser"), cell: (sandbox) => <span className="admin-mono">{sandbox.hub_username}</span> },
                ...(actions
                  ? [
                      {
                        key: "actions",
                        header: t("colActions"),
                        cell: (sandbox: (typeof sandboxes)[number]) =>
                          sandbox.deleted_at || !(sandbox.session_started_at || sandbox.state === "running" || sandbox.state === "pending") ? null : (
                            <ActionButton
                              danger
                              trigger={stop("trigger")}
                              build={() => ({
                                title: stop("title"),
                                body: stop("body", { project: sandbox.project_name }),
                                confirm: stop("confirm"),
                                run: async (reason) => {
                                  await sendAction("/api/actions/sandbox/stop", { projectId: sandbox.project_id }, reason);
                                  reload();
                                },
                              })}
                            />
                          ),
                      },
                    ]
                  : []),
              ]}
            />
          )}
        </Section>
      </div>
    </>
  );
}
