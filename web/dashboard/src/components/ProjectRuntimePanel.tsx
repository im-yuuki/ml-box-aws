"use client";

import { useEffect, useState } from "react";
import { Alert, Button, Card, Chip, Label, ListBox, Select, Spinner } from "@heroui/react";
import { ExternalLink, Play, Square } from "lucide-react";
import { useTranslations } from "next-intl";
import { bffFetch } from "@/lib/bffFetch";
import { useProjectSandbox } from "@/hooks/useProjectSandbox";
import { runtimeChipColor } from "@/lib/artifacts";

type UsageSummary = { hours: number; sessions: number; openSession: boolean; windowDays: number };

/** Runtime section of the project detail page: state, start/stop, recorded usage. */
export default function ProjectRuntimePanel({ projectId }: { projectId: string }) {
  const t = useTranslations("projectRuntime");
  const { data, loading, busy, error, stateKey, canOperate, profiles, act } = useProjectSandbox(projectId);
  const [profile, setProfile] = useState("cpu-small");
  const [usage, setUsage] = useState<UsageSummary | null>(null);

  useEffect(() => {
    let cancelled = false;
    const task = window.setTimeout(() => {
      bffFetch(`/api/bff/projects/${encodeURIComponent(projectId)}/usage`, { cache: "no-store" })
        .then((response) => (response.ok ? response.json() as Promise<{ usage?: UsageSummary }> : null))
        .then((body) => {
          if (!cancelled) setUsage(body?.usage ?? null);
        })
        .catch(() => undefined);
    }, 0);
    return () => {
      cancelled = true;
      window.clearTimeout(task);
    };
  }, [projectId]);

  const url = data?.sandbox?.url ?? null;
  const running = stateKey === "running";

  return (
    <Card>
      <Card.Header>
        <Card.Title>{t("title")}</Card.Title>
      </Card.Header>
      <Card.Content className="flex flex-col gap-4">
        {loading && !data ? <div className="flex items-center gap-2 text-sm" role="status"><Spinner size="sm" /><span>{t("loading")}</span></div> : null}
        {data ? <Chip size="sm" variant="soft" color={runtimeChipColor(stateKey)} aria-live="polite" className="w-fit">{t(`state.${stateKey}`)}</Chip> : null}
        {error ? <Alert status="danger"><Alert.Content><Alert.Description>{t(error)}</Alert.Description></Alert.Content></Alert> : null}
        {!running ? (
          <Select
            selectedKey={profile}
            onSelectionChange={(key) => key && setProfile(String(key))}
            variant="secondary"
            isDisabled={busy || loading || !canOperate || stateKey === "starting"}
          >
            <Label>{t("profileLabel")}</Label>
            <Select.Trigger>
              <Select.Value />
              <Select.Indicator />
            </Select.Trigger>
            <Select.Popover>
              <ListBox>
                {profiles.map((option) => (
                  <ListBox.Item key={option.slug} id={option.slug} textValue={option.label} isDisabled={!option.available}>
                    <span className="flex flex-col">
                      <span>{option.label}</span>
                      <span className="text-xs" style={{ color: "var(--muted)" }}>{option.description}</span>
                    </span>
                    <ListBox.ItemIndicator />
                  </ListBox.Item>
                ))}
              </ListBox>
            </Select.Popover>
          </Select>
        ) : null}
        <div className="flex flex-wrap gap-2">
          {running && url ? (
            <Button variant="secondary" size="sm" onPress={() => window.open(url, "_blank", "noopener")} fullWidth><ExternalLink aria-hidden="true" size={14} />{t("open")}</Button>
          ) : (
            <Button variant="primary" size="sm" isDisabled={busy || loading || !canOperate || stateKey === "starting"} onPress={() => void act("start", profile)} fullWidth>
              <Play aria-hidden="true" size={14} />
              {t("start")}
            </Button>
          )}
          {running ? (
            <Button variant="danger-soft" size="sm" isDisabled={busy || loading || !canOperate} onPress={() => void act("stop")} fullWidth>
              <Square aria-hidden="true" size={14} />
              {t("stop")}
            </Button>
          ) : null}
        </div>
        {data && !canOperate ? <p className="workspace-muted-copy">{t("readOnly")}</p> : null}
        {usage ? <p className="workspace-muted-copy">{t("usage", { hours: usage.hours, days: usage.windowDays })}</p> : null}
      </Card.Content>
    </Card>
  );
}
