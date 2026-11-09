"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
} from "react";
import { Alert, Button, Card, Label, Modal, Spinner, Switch } from "@heroui/react";
import { Download, Upload } from "lucide-react";
import { useTranslations } from "next-intl";
import { bffFetch } from "@/lib/bffFetch";
import {
  formatBytes,
  validateUploadFile,
  type ArtifactListResponse,
  type ArtifactRecord,
  type ArtifactSettings,
} from "@/lib/artifacts";

type CreateResponse = {
  artifact: ArtifactRecord;
  upload: { url: string; method: "PUT"; headers: Record<string, string> };
};

const GIB = 1024 * 1024 * 1024;

export default function ProjectArtifactsPanel({
  projectId,
}: {
  projectId: string;
}) {
  const t = useTranslations("projectArtifacts");
  const [artifacts, setArtifacts] = useState<ArtifactRecord[]>([]);
  const [settings, setSettings] = useState<ArtifactSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [toggling, setToggling] = useState(false);
  // Number of stored files awaiting the user's confirmation to turn storage off; null when closed.
  const [confirmCount, setConfirmCount] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [canWrite, setCanWrite] = useState(true);
  const fileInput = useRef<HTMLInputElement>(null);

  const base = `/api/bff/projects/${encodeURIComponent(projectId)}/artifacts`;

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const response = await bffFetch(base, { cache: "no-store" });
      if (!response.ok) {
        setError(t("loadFailed"));
        return;
      }
      const body = (await response.json()) as ArtifactListResponse;
      setArtifacts(Array.isArray(body.artifacts) ? body.artifacts : []);
      setSettings(body.settings ?? null);
      setCanWrite(body.canOperate === true);
      setError(null);
    } catch {
      setError(t("loadFailed"));
    } finally {
      setLoading(false);
    }
  }, [base, t]);

  useEffect(() => {
    const task = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(task);
  }, [load]);

  // Turning storage off with files stored is answered 409 first; the user confirms and the request is repeated.
  const setStorage = async (enabled: boolean, confirmDeleteAll = false) => {
    setToggling(true);
    setError(null);
    try {
      const response = await bffFetch(`${base}/settings`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ enabled, confirmDeleteAll }),
      });
      if (response.status === 409) {
        const body = (await response.json().catch(() => ({}))) as { count?: number };
        setConfirmCount(body.count ?? 0);
        return;
      }
      if (!response.ok) {
        setError(t("toggleFailed"));
        return;
      }
      setConfirmCount(null);
      await load();
    } catch {
      setError(t("toggleFailed"));
    } finally {
      setToggling(false);
    }
  };

  const upload = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    const check = validateUploadFile({ name: file.name, size: file.size });
    if (!check.ok) {
      setError(t(`invalid.${check.reason}`));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const created = await bffFetch(base, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: file.name,
          contentType: file.type || "application/octet-stream",
          sizeBytes: file.size,
        }),
      });
      if (!created.ok) {
        const body = (await created.json().catch(() => ({}))) as { error?: string };
        if (created.status === 403) {
          setCanWrite(false);
          setError(t("forbidden"));
        } else if (body.error === "ARTIFACTS_DISABLED") {
          setError(t("disabledHint"));
        } else if (body.error === "QUOTA_EXCEEDED") {
          setError(t("quotaExceeded"));
        } else {
          setError(t("uploadFailed"));
        }
        await load();
        return;
      }
      const body = (await created.json()) as CreateResponse;
      const put = await fetch(body.upload.url, {
        method: "PUT",
        headers: body.upload.headers,
        body: file,
      });
      if (!put.ok) {
        setError(t("uploadFailed"));
        return;
      }
      const completed = await bffFetch(
        `${base}/${encodeURIComponent(body.artifact.id)}/complete`,
        { method: "POST" },
      );
      if (!completed.ok) {
        setError(t("uploadFailed"));
        return;
      }
      await load();
    } catch {
      setError(t("uploadFailed"));
    } finally {
      setBusy(false);
    }
  };

  const download = async (artifact: ArtifactRecord) => {
    setError(null);
    try {
      const response = await bffFetch(
        `${base}/${encodeURIComponent(artifact.id)}/download`,
        { cache: "no-store" },
      );
      if (!response.ok) {
        setError(t("downloadFailed"));
        return;
      }
      const body = (await response.json()) as { url: string };
      window.location.assign(body.url);
    } catch {
      setError(t("downloadFailed"));
    }
  };

  const enabled = settings?.enabled ?? false;

  return (
    <Card>
      <Card.Header>
        <Card.Title>{t("title")}</Card.Title>
      </Card.Header>
      <Card.Content className="flex flex-col gap-5">
        {loading ? (
          <div className="flex items-center gap-2 text-sm" role="status">
            <Spinner size="sm" />
            <span>{t("loading")}</span>
          </div>
        ) : null}

        {settings ? (
          <section aria-labelledby="artifact-storage-heading" className="flex flex-col gap-3 border-b pb-5" style={{ borderColor: "var(--border)" }}>
            <h3 id="artifact-storage-heading" className="text-sm font-medium">{t("storageHeading")}</h3>
            <p className="text-xs" style={{ color: "var(--muted)" }}>{t("storageBody")}</p>

            <Switch
              isSelected={enabled}
              isDisabled={!canWrite || toggling || busy}
              onChange={(next) => void setStorage(next)}
            >
              <Switch.Control>
                <Switch.Thumb />
              </Switch.Control>
              <Switch.Content>
                <Label>{t("enableLabel")}</Label>
              </Switch.Content>
            </Switch>
            <p className="text-xs" style={{ color: "var(--muted)" }}>{t("enableHint")}</p>
            <p className="text-sm">{t("retention", { days: settings.retentionDays })}</p>

            <StorageUsage settings={settings} />
          </section>
        ) : null}

        {!loading && artifacts.length === 0 ? (
          <p className="workspace-muted-copy">{t("empty")}</p>
        ) : null}
        <ul aria-label={t("list")} className="flex flex-col gap-2">
          {artifacts
            .filter((artifact) => artifact.status === "ready")
            .map((artifact) => (
              <li
                key={artifact.id}
                className="flex items-center justify-between gap-4">
                <span>
                  {artifact.name} · {formatBytes(artifact.sizeBytes)}
                </span>
                <Button
                  variant="outline"
                  size="sm"
                  onPress={() => void download(artifact)}>
                  <Download aria-hidden="true" size={14} />
                  {t("download")}
                </Button>
              </li>
            ))}
        </ul>
        {canWrite ? (
          enabled ? (
            <div className="flex items-center gap-3">
              <Button
                variant="tertiary"
                size="sm"
                isDisabled={busy}
                onPress={() => fileInput.current?.click()}
                fullWidth>
                <Upload aria-hidden="true" size={14} />
                {t("chooseFile")}
              </Button>
              <input
                ref={fileInput}
                type="file"
                className="sr-only"
                tabIndex={-1}
                disabled={busy}
                onChange={(event) => void upload(event)}
              />
            </div>
          ) : (
            <p className="workspace-muted-copy">{t("disabledHint")}</p>
          )
        ) : (
          <p className="workspace-muted-copy">{t("readOnly")}</p>
        )}
        {busy ? (
          <div className="flex items-center gap-2 text-sm" role="status">
            <Spinner size="sm" />
            <span>{t("uploading")}</span>
          </div>
        ) : null}
        {error ? (
          <Alert status="danger">
            <Alert.Content>
              <Alert.Description>{error}</Alert.Description>
            </Alert.Content>
          </Alert>
        ) : null}

        <Modal
          isOpen={confirmCount !== null}
          onOpenChange={(open) => {
            if (!open) setConfirmCount(null);
          }}>
          <Modal.Backdrop>
            <Modal.Container>
              <Modal.Dialog>
                {({ close }) => (
                  <>
                    <Modal.Header>
                      <Modal.Heading>{t("confirmDisableTitle")}</Modal.Heading>
                    </Modal.Header>
                    <Modal.Body>
                      <p className="text-sm">{t("confirmDisableBody", { count: confirmCount ?? 0 })}</p>
                    </Modal.Body>
                    <Modal.Footer className="flex justify-end gap-2">
                      <Button variant="tertiary" onPress={close}>{t("cancel")}</Button>
                      <Button
                        variant="danger"
                        isPending={toggling}
                        isDisabled={toggling}
                        onPress={() => void setStorage(false, true)}>
                        {t("confirmDisableAction")}
                      </Button>
                    </Modal.Footer>
                  </>
                )}
              </Modal.Dialog>
            </Modal.Container>
          </Modal.Backdrop>
        </Modal>
      </Card.Content>
    </Card>
  );
}

/** Stacked bar: this Project, other Projects in the Space, and what is still free under the plan quota. */
function StorageUsage({ settings }: { settings: ArtifactSettings }) {
  const t = useTranslations("projectArtifacts");
  const { quotaGb, projectBytes, otherProjectBytes } = settings.storage;
  const used = projectBytes + otherProjectBytes;
  if (quotaGb === null) {
    return <p className="text-xs" style={{ color: "var(--muted)" }}>{t("storageUnlimited")}</p>;
  }
  const quota = quotaGb * GIB;
  const share = (bytes: number) => Math.min(100, (bytes / quota) * 100);
  const projectShare = share(projectBytes);
  const otherShare = Math.min(100 - projectShare, share(otherProjectBytes));
  return (
    <div className="flex flex-col gap-2">
      <div
        role="img"
        aria-label={t("storageUsage", { used: formatBytes(used), quota: `${quotaGb} GB` })}
        className="flex h-2 w-full overflow-hidden rounded-full"
        style={{ background: "var(--surface-secondary)" }}>
        <span style={{ width: `${projectShare}%`, background: "var(--accent)" }} />
        <span style={{ width: `${otherShare}%`, background: "var(--accent)", opacity: 0.45 }} />
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2 text-xs" style={{ color: "var(--muted)" }}>
        <span>{t("storageUsage", { used: formatBytes(used), quota: `${quotaGb} GB` })}</span>
        <span>
          {t("storageThis")}: {formatBytes(projectBytes)} · {t("storageOthers")}: {formatBytes(otherProjectBytes)} · {t("storageFree")}: {formatBytes(Math.max(0, quota - used))}
        </span>
      </div>
    </div>
  );
}
