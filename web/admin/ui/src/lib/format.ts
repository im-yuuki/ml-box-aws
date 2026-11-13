export type ChipColor = "default" | "accent" | "success" | "warning" | "danger";

/** Maps the backend status words onto HeroUI chip colours. */
export function chipColor(status: "ok" | "warn" | "error" | "info"): ChipColor {
  switch (status) {
    case "ok":
      return "success";
    case "warn":
      return "warning";
    case "error":
      return "danger";
    default:
      return "default";
  }
}

const SANDBOX_STATE: Record<string, "ok" | "warn" | "error" | "info"> = {
  running: "ok",
  ready: "ok",
  pending: "warn",
  spawning: "warn",
  stopped: "info",
  failed: "error",
};

export function sandboxStateStatus(state: string): "ok" | "warn" | "error" | "info" {
  return SANDBOX_STATE[state] ?? "info";
}

/** "ghcr.io/owner/mlbox-bff:<40 hex>" -> "mlbox-bff:dbcd98f". */
export function shortImage(image: string): string {
  const withoutDigest = image.split("@")[0];
  const colon = withoutDigest.lastIndexOf(":");
  const hasTag = colon > withoutDigest.lastIndexOf("/");
  const name = (hasTag ? withoutDigest.slice(0, colon) : withoutDigest).split("/").pop() ?? withoutDigest;
  const tag = hasTag ? withoutDigest.slice(colon + 1) : "latest";
  return `${name}:${/^[0-9a-f]{40}$/.test(tag) ? tag.slice(0, 7) : tag}`;
}

export function formatDuration(seconds: number): { hours: number; minutes: number } {
  const total = Math.max(0, Math.round(Number.isFinite(seconds) ? seconds : 0));
  return { hours: Math.floor(total / 3600), minutes: Math.floor((total % 3600) / 60) };
}

/** Binary units, one decimal: 12000000 -> "11.4 MiB". */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  const units = ["B", "KiB", "MiB", "GiB", "TiB"];
  let value = bytes;
  let index = 0;
  while (value >= 1024 && index < units.length - 1) {
    value /= 1024;
    index += 1;
  }
  return `${index === 0 ? Math.round(value) : value.toFixed(1)} ${units[index]}`;
}

/** The status of a quantity measured against a limit: a warning from 80 percent, an error when it is used up. */
export function usageStatus(used: number, limit: number | null): "ok" | "warn" | "error" | "info" {
  if (limit === null) return "info";
  if (limit <= 0) return used > 0 ? "error" : "info";
  const ratio = used / limit;
  if (ratio >= 1) return "error";
  return ratio >= 0.8 ? "warn" : "ok";
}

/** Percent of a limit that is used, between 0 and 100. */
export function usagePercent(used: number, limit: number | null): number {
  if (limit === null || limit <= 0) return 0;
  return Math.min(100, Math.max(0, (used / limit) * 100));
}
