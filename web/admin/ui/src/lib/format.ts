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
