// Client-side checks mirror the BFF limits (web/bff/src/artifacts.ts). The server remains the authority.
export const ARTIFACT_MAX_BYTES = 100 * 1024 * 1024;

export type ArtifactRecord = {
  id: string;
  projectId: string;
  name: string;
  contentType: string;
  sizeBytes: number;
  status: "pending" | "ready";
  createdBy: string;
};

export type ArtifactListResponse = { projectId?: string; canOperate?: boolean; artifacts?: ArtifactRecord[] };

export type UploadValidation = { ok: true } | { ok: false; reason: "empty" | "tooLarge" | "name" };

export function validateUploadFile(file: { name: string; size: number }): UploadValidation {
  if (!file.name.trim() || file.name.length > 120) return { ok: false, reason: "name" };
  if (file.size <= 0) return { ok: false, reason: "empty" };
  if (file.size > ARTIFACT_MAX_BYTES) return { ok: false, reason: "tooLarge" };
  return { ok: true };
}

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return "—";
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB"];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toFixed(value >= 10 ? 0 : 1)} ${units[unit]}`;
}

export type RuntimeStateKey = "running" | "starting" | "stopped" | "failed" | "unknown";

export function runtimeStateKey(state: string | null | undefined): RuntimeStateKey {
  if (state === "ready" || state === "running") return "running";
  if (state === "starting" || state === "pending") return "starting";
  if (state === "stopped") return "stopped";
  if (state === "failed") return "failed";
  return "unknown";
}

/** Chip colour for a runtime state: colour plus text, never colour alone. */
export function runtimeChipColor(state: RuntimeStateKey): "success" | "warning" | "danger" | "default" {
  if (state === "running") return "success";
  if (state === "starting") return "warning";
  if (state === "failed") return "danger";
  return "default";
}
