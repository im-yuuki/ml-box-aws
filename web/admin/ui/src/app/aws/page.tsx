"use client";

import { Card } from "@heroui/react";
import { useTranslations } from "next-intl";
import CardSectionTitle from "@/components/CardSectionTitle";
import DateTime from "@/components/DateTime";
import PageHeading from "@/components/PageHeading";
import PageError from "@/components/PageState";
import Section from "@/components/Section";
import StatusChip from "@/components/StatusChip";
import { useApi } from "@/hooks/useApi";
import { parseDetailKey } from "@/lib/details";
import type { AwsResource, AwsResponse } from "@/lib/types";

/** The backend sends stable keys and neutral values; this turns them into words of the language of the operator. */
function DetailRows({ details }: { details: AwsResource["details"] }) {
  const t = useTranslations("aws");
  const common = useTranslations("common");

  const label = (key: string) => {
    const { base, param } = parseDetailKey(key);
    if (base === "record") return param;
    return t.has(`detail.${base}`) ? t(`detail.${base}`, { name: param }) : key;
  };

  const value = (key: string, raw: string) => {
    const { base } = parseDetailKey(key);
    if (raw === "yes") return common("yes");
    if (raw === "no") return common("no");
    if (base === "createdAt") return <DateTime value={raw} />;
    if (base === "uptimeHours") return t("hours", { count: Number(raw) });
    if (base === "daysLeft") return t("days", { count: Number(raw) });
    return raw;
  };

  return (
    <dl className="admin-kv">
      {details.flatMap(([key, raw]) => [
        <dt key={`${key}-k`}>{label(key)}</dt>,
        <dd key={`${key}-v`}>{value(key, raw)}</dd>,
      ])}
    </dl>
  );
}

function ResourceCard({ resource }: { resource: AwsResource }) {
  return (
    <Card variant="secondary" className="flex flex-col gap-3 p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <span className="workspace-mono-label">{resource.kind}</span>
          <CardSectionTitle className="break-all text-base">{resource.name}</CardSectionTitle>
        </div>
        <StatusChip status={resource.status}>{resource.statusText}</StatusChip>
      </div>
      <DetailRows details={resource.details} />
    </Card>
  );
}

export default function AwsPage() {
  const t = useTranslations("aws");
  const { data, error, loading, reload } = useApi<AwsResponse>("/api/aws");

  return (
    <>
      <PageHeading eyebrow={t("eyebrow")} title={t("title")} subtitle={t("subtitle")} onRefresh={reload} loading={loading} />
      <div className="admin-stack">
        <PageError message={error} />
        {data ? <p className="workspace-count-label">{t("scope", { region: data.region, cluster: data.cluster })}</p> : null}
        {(data?.layers ?? []).map((layer) => (
          <Section key={layer.id} title={t(`layers.${layer.id}`)} result={layer.section}>
            {(resources) =>
              resources.length === 0 ? (
                <p className="text-sm" style={{ color: "var(--muted)" }}>
                  {t("empty")}
                </p>
              ) : (
                <div className="admin-resource-grid">
                  {resources.map((resource) => (
                    <ResourceCard key={resource.id} resource={resource} />
                  ))}
                </div>
              )
            }
          </Section>
        ))}
      </div>
    </>
  );
}
