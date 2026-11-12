"use client";

import { useState } from "react";
import { Label, ListBox, Select } from "@heroui/react";
import { Card } from "@heroui/react";
import { useTranslations } from "next-intl";
import CardSectionTitle from "@/components/CardSectionTitle";
import DataTable from "@/components/DataTable";
import DateTime from "@/components/DateTime";
import PageHeading from "@/components/PageHeading";
import PageError from "@/components/PageState";
import Section from "@/components/Section";
import { useApi } from "@/hooks/useApi";
import type { AuditResponse } from "@/lib/types";

const ALL = "__all__";

export default function AuditPage() {
  const t = useTranslations("audit");
  const [action, setAction] = useState<string>(ALL);
  const path = `/api/audit?limit=100${action === ALL ? "" : `&action=${encodeURIComponent(action)}`}`;
  const { data, error, loading, reload } = useApi<AuditResponse>(path);
  const known = data?.actions.ok ? data.actions.data : [];

  return (
    <>
      <PageHeading eyebrow={t("eyebrow")} title={t("title")} subtitle={t("subtitle")} onRefresh={reload} loading={loading} />
      <div className="admin-stack">
        <PageError message={error} />

        <Select
          className="w-full max-w-sm"
          selectedKey={action}
          onSelectionChange={(key) => setAction(key === null ? ALL : String(key))}
          aria-label={t("filter")}>
          <Label>{t("filter")}</Label>
          <Select.Trigger>
            <Select.Value />
            <Select.Indicator />
          </Select.Trigger>
          <Select.Popover>
            <ListBox>
              <ListBox.Item id={ALL} textValue={t("allActions")}>
                {t("allActions")}
                <ListBox.ItemIndicator />
              </ListBox.Item>
              {known.map((item) => (
                <ListBox.Item key={item.action} id={item.action} textValue={item.action}>
                  <span className="admin-mono">{item.action}</span> ({item.count})
                  <ListBox.ItemIndicator />
                </ListBox.Item>
              ))}
            </ListBox>
          </Select.Popover>
        </Select>

        <Section title={t("userEvents")} result={data?.events}>
          {(events) => (
            <DataTable
              label={t("userEvents")}
              rows={events}
              rowId={(event) => event.id}
              empty={t("userEventsEmpty")}
              columns={[
                { key: "when", header: t("colWhen"), cell: (event) => <DateTime value={event.created_at} /> },
                { key: "actor", header: t("colActor"), cell: (event) => event.actor_email },
                { key: "space", header: t("colSpace"), cell: (event) => event.space_name },
                { key: "action", header: t("colAction"), cell: (event) => <span className="admin-mono">{event.action}</span> },
                { key: "target", header: t("colTarget"), cell: (event) => <span className="admin-mono">{event.target}</span> },
              ]}
            />
          )}
        </Section>

        <Card className="flex flex-col gap-4 p-5">
          <CardSectionTitle>{t("adminActions")}</CardSectionTitle>
          <DataTable
            label={t("adminActions")}
            rows={data?.adminActions.slice(0, 30) ?? []}
            rowId={(row, index) => `${row.at}/${index}`}
            empty={t("adminActionsEmpty")}
            columns={[
              { key: "when", header: t("colWhen"), cell: (row) => <DateTime value={row.at} /> },
              { key: "ip", header: t("colIp"), cell: (row) => <span className="admin-mono">{row.ip}</span> },
              { key: "action", header: t("colAction"), cell: (row) => <span className="admin-mono">{row.action}</span> },
              { key: "detail", header: t("colDetail"), cell: (row) => row.detail ?? "" },
            ]}
          />
        </Card>
      </div>
    </>
  );
}
