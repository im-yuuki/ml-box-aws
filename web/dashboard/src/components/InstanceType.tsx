"use client";

import { Cpu, Gpu } from "lucide-react";
import { useTranslations } from "next-intl";
import type { SandboxProfileOption } from "@/hooks/useProjectSandbox";
import { instanceKindFor, instanceLabelFor } from "@/lib/instances";

/** An instance codename with a CPU or GPU icon, so the kind reads at a glance. */
export default function InstanceType({
  slug,
  profiles = [],
}: {
  slug: string;
  profiles?: SandboxProfileOption[];
}) {
  const t = useTranslations("projectRuntime");
  const kind = instanceKindFor(slug, profiles);
  const Icon = kind === "gpu" ? Gpu : Cpu;
  return (
    <span className="inline-flex items-center gap-1.5 text-sm">
      <Icon aria-hidden="true" size={14} />
      <span>{instanceLabelFor(slug, profiles)}</span>
      <span className="sr-only">{t(kind === "gpu" ? "instanceGpu" : "instanceCpu")}</span>
    </span>
  );
}
