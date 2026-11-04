"use client";

import { useCallback, useEffect, useState, type ChangeEvent } from "react";
import { Button, Card } from "@heroui/react";
import { useTranslations } from "next-intl";
import { bffFetch } from "@/lib/bffFetch";
import { formatBytes, validateUploadFile, type ArtifactListResponse, type ArtifactRecord } from "@/lib/artifacts";

type CreateResponse = {
  artifact: ArtifactRecord;
  upload: { url: string; method: "PUT"; headers: Record<string, string> };
};

export default function ProjectArtifactsPanel({ projectId }: { projectId: string }) {
  const t = useTranslations("projectArtifacts");
  const [artifacts, setArtifacts] = useState<ArtifactRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [canWrite, setCanWrite] = useState(true);

  const base = `/api/bff/projects/${encodeURIComponent(projectId)}/artifacts`;

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const response = await bffFetch(base, { cache: "no-store" });
      if (!response.ok) {
        setError(t("loadFailed"));
        return;
      }
      const body = await response.json() as ArtifactListResponse;
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
        body: JSON.stringify({ name: file.name, contentType: file.type || "application/octet-stream", sizeBytes: file.size }),
      });
      if (!created.ok) {
        setCanWrite(created.status !== 403);
        setError(created.status === 403 ? t("forbidden") : t("uploadFailed"));
        return;
      }
      const body = await created.json() as CreateResponse;
      const put = await fetch(body.upload.url, { method: "PUT", headers: body.upload.headers, body: file });
      if (!put.ok) {
        setError(t("uploadFailed"));
        return;
      }
      const completed = await bffFetch(`${base}/${encodeURIComponent(body.artifact.id)}/complete`, { method: "POST" });
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
      const response = await bffFetch(`${base}/${encodeURIComponent(artifact.id)}/download`, { cache: "no-store" });
      if (!response.ok) {
        setError(t("downloadFailed"));
        return;
      }
      const body = await response.json() as { url: string };
      window.location.href = body.url;
    } catch {
      setError(t("downloadFailed"));
    }
  };

  return (
    <Card className="workspace-detail-section">
      <span className="workspace-section-index">{t("section")}</span>
      <h2>{t("title")}</h2>
      <p>{t("body")}</p>
      {loading ? <p className="workspace-muted-copy" role="status">{t("loading")}</p> : null}
      {!loading && artifacts.length === 0 ? <p className="workspace-muted-copy">{t("empty")}</p> : null}
      <ul aria-label={t("list")} className="flex flex-col gap-2">
        {artifacts.filter((artifact) => artifact.status === "ready").map((artifact) => (
          <li key={artifact.id} className="flex items-center justify-between gap-4">
            <span>{artifact.name} · {formatBytes(artifact.sizeBytes)}</span>
            <Button variant="secondary" size="sm" onPress={() => void download(artifact)}>{t("download")}</Button>
          </li>
        ))}
      </ul>
      {canWrite ? (
        <label className="flex flex-col gap-2">
          <span className="sr-only">{t("chooseFile")}</span>
          <input type="file" disabled={busy} onChange={(event) => void upload(event)} />
        </label>
      ) : <p className="workspace-muted-copy">{t("readOnly")}</p>}
      {busy ? <p className="workspace-muted-copy" role="status">{t("uploading")}</p> : null}
      {error ? <p className="workspace-form-error" role="alert">{error}</p> : null}
    </Card>
  );
}
