"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
} from "react";
import { Alert, Button, Card, Spinner } from "@heroui/react";
import { Download, Upload } from "lucide-react";
import { useTranslations } from "next-intl";
import { bffFetch } from "@/lib/bffFetch";
import {
  formatBytes,
  validateUploadFile,
  type ArtifactListResponse,
  type ArtifactRecord,
} from "@/lib/artifacts";

type CreateResponse = {
  artifact: ArtifactRecord;
  upload: { url: string; method: "PUT"; headers: Record<string, string> };
};

export default function ProjectArtifactsPanel({
  projectId,
}: {
  projectId: string;
}) {
  const t = useTranslations("projectArtifacts");
  const [artifacts, setArtifacts] = useState<ArtifactRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
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
        setCanWrite(created.status !== 403);
        setError(created.status === 403 ? t("forbidden") : t("uploadFailed"));
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

  return (
    <Card>
      <Card.Header>
        <Card.Title>{t("title")}</Card.Title>
      </Card.Header>
      <Card.Content className="flex flex-col gap-4">
        {loading ? (
          <div className="flex items-center gap-2 text-sm" role="status">
            <Spinner size="sm" />
            <span>{t("loading")}</span>
          </div>
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
      </Card.Content>
    </Card>
  );
}
