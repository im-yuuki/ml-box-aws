// Artifact helpers (phase 5 MVP). Object keys are always built server-side under the Project's
// Space/Project prefix; clients never choose a key.

export const ARTIFACT_MAX_BYTES = 100 * 1024 * 1024;
export const ARTIFACT_NAME_MAX_LENGTH = 120;
export const PRESIGN_UPLOAD_SECONDS = 15 * 60;
export const PRESIGN_DOWNLOAD_SECONDS = 5 * 60;

const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;

export function sanitizeArtifactName(name: string): string | null {
  const trimmed = name.trim();
  if (!trimmed || trimmed.length > ARTIFACT_NAME_MAX_LENGTH) return null;
  // Keep only a plain basename: no path separators, no leading dots.
  const base = trimmed.split(/[\\/]/).pop() ?? "";
  const cleaned = base.replace(/[^A-Za-z0-9._-]+/g, "_").replace(/^\.+/, "");
  if (!cleaned || cleaned.length > ARTIFACT_NAME_MAX_LENGTH) return null;
  return cleaned;
}

export function validateArtifactSize(sizeBytes: unknown): number | null {
  if (typeof sizeBytes !== "number" || !Number.isSafeInteger(sizeBytes)) return null;
  if (sizeBytes <= 0 || sizeBytes > ARTIFACT_MAX_BYTES) return null;
  return sizeBytes;
}

export function buildArtifactObjectKey(spaceId: string, projectId: string, artifactId: string, fileName: string): string {
  for (const id of [spaceId, projectId, artifactId]) {
    if (!SAFE_ID.test(id)) throw new Error("Invalid identifier for artifact key");
  }
  const safeName = sanitizeArtifactName(fileName);
  if (!safeName) throw new Error("Invalid artifact name");
  return `spaces/${spaceId}/projects/${projectId}/artifacts/${artifactId}/${safeName}`;
}

export function artifactKeyPrefix(spaceId: string, projectId: string): string {
  if (!SAFE_ID.test(spaceId) || !SAFE_ID.test(projectId)) throw new Error("Invalid identifier for artifact prefix");
  return `spaces/${spaceId}/projects/${projectId}/`;
}
