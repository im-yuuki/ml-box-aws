"use client";

import { useCallback, useEffect, useState, type ChangeEvent } from "react";
import { Button } from "@heroui/react";
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
    <section className="panel">
      <div className="runtime-head">
        <h2 className="panel-title">{t("title")}</h2>
        <span className="pill">{artifacts.filter((artifact) => artifact.status === "ready").length}</span>
      </div>
      <p className="muted">{t("body")}</p>
      {loading ? <p className="muted" role="status">{t("loading")}</p> : null}
      {!loading && artifacts.length === 0 ? <p className="muted">{t("empty")}</p> : null}
      <ul aria-label={t("list")} className="artifact-list">
        {artifacts.filter((artifact) => artifact.status === "ready").map((artifact) => (
          <li key={artifact.id} className="artifact-row">
            <span className="artifact-name">{artifact.name}</span>
            <span className="muted small">{formatBytes(artifact.sizeBytes)}</span>
            <Button variant="secondary" size="sm" onPress={() => void download(artifact)}>{t("download")}</Button>
          </li>
        ))}
      </ul>
      {canWrite ? (
        <label className="file-drop">
          <span className="sr-only">{t("chooseFile")}</span>
          <input type="file" disabled={busy} onChange={(event) => void upload(event)} />
        </label>
      ) : <p className="muted">{t("readOnly")}</p>}
      {busy ? <p className="muted" role="status">{t("uploading")}</p> : null}
      {error ? <p className="form-error" role="alert">{error}</p> : null}
    </section>
  );
}
