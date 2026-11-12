import { Card } from "@heroui/react";
import type { ReactNode } from "react";

/** One headline number. */
export default function StatCard({ label, value, hint }: { label: string; value: ReactNode; hint?: ReactNode }) {
  return (
    <Card className="flex flex-col gap-1 p-5">
      <span className="workspace-mono-label">{label}</span>
      <span className="text-3xl font-semibold tabular-nums">{value}</span>
      {hint ? (
        <span className="text-xs" style={{ color: "var(--muted)" }}>
          {hint}
        </span>
      ) : null}
    </Card>
  );
}
