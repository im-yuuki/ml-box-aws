import { Cpu, Gpu } from "lucide-react";

const GPU_FAMILY = /^(g\d|p\d|d\d|gr\d)/i;

/** An EC2 instance type or a profile slug with a CPU or GPU icon, same look as in the dashboard. */
export default function InstanceType({ type }: { type: string | null | undefined }) {
  if (!type) return <span style={{ color: "var(--muted)" }}>—</span>;
  const Icon = GPU_FAMILY.test(type) ? Gpu : Cpu;
  return (
    <span className="inline-flex items-center gap-1.5 text-sm">
      <Icon aria-hidden="true" size={14} />
      <span className="admin-mono">{type}</span>
    </span>
  );
}
