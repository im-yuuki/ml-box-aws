import { ProgressBar } from "@heroui/react";
import { usagePercent, usageStatus } from "@/lib/format";

const COLOR = { ok: "success", warn: "warning", error: "danger", info: "default" } as const;

/** A quantity against its limit, with the colour of the dashboard's meters. The text next to it carries the exact numbers. */
export default function UsageBar({ used, limit, label }: { used: number; limit: number | null; label: string }) {
  return (
    <ProgressBar aria-label={label} value={usagePercent(used, limit)} color={COLOR[usageStatus(used, limit)]} size="sm">
      <ProgressBar.Track>
        <ProgressBar.Fill />
      </ProgressBar.Track>
    </ProgressBar>
  );
}
