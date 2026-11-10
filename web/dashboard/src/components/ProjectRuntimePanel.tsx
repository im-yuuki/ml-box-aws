"use client";

import { useEffect, useState } from "react";
import { Button, Card, Chip, Label, ListBox, Select, Spinner } from "@heroui/react";
import FeedbackAlert from "@/components/FeedbackAlert";
import { ExternalLink, Play, Square } from "lucide-react";
import { useTranslations } from "next-intl";
import { bffFetch } from "@/lib/bffFetch";
import { useProjectSandbox } from "@/hooks/useProjectSandbox";
import { runtimeChipColor } from "@/lib/artifacts";
import { openNotebookViaHandoff } from "@/lib/notebookHandoff";
import InstanceType from "@/components/InstanceType";

type UsageSummary = { hours: number; sessions: number; openSession: boolean; windowDays: number };

/** Runtime section of the project detail page: state, start/stop, recorded usage. */
export default function ProjectRuntimePanel({ projectId }: { projectId: string }) {
  const t = useTranslations("projectRuntime");
  const { data, loading, busy, error, stateKey, canOperate, profiles, runningProfile, preferredProfile, act } = useProjectSandbox(projectId);
  // The user's choice wins; otherwise the last started profile, then the default one.
  const [chosenProfile, setChosenProfile] = useState<string | null>(null);
  const profile = chosenProfile ?? preferredProfile ?? "cpu-small";
  const [usage, setUsage] = useState<UsageSummary | null>(null);
  const [openFailed, setOpenFailed] = useState(false);

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
        <p className="workspace-muted-copy">{t("body")}</p>
        {running && runningProfile ? (
          <p className="text-sm" aria-live="polite"><span style={{ color: "var(--muted)" }}>{t("instanceLabel")}: </span><InstanceType slug={runningProfile} profiles={profiles} /></p>
        ) : !running && preferredProfile ? (
          <p className="text-sm" style={{ color: "var(--muted)" }}>{t("instanceDefault")} <InstanceType slug={preferredProfile} profiles={profiles} /></p>
        ) : null}
        {error ? <FeedbackAlert status="danger">{t(error)}</FeedbackAlert> : null}
        {openFailed ? <FeedbackAlert status="danger">{t("openFailed")}</FeedbackAlert> : null}
        {!running ? (
          <Select
            selectedKey={profile}
            onSelectionChange={(key) => key && setChosenProfile(String(key))}
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
            <Button variant="secondary" size="sm" onPress={() => { setOpenFailed(false); void openNotebookViaHandoff(url).then((ok) => { if (!ok) setOpenFailed(true); }); }} fullWidth><ExternalLink aria-hidden="true" size={14} />{t("open")}</Button>
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
