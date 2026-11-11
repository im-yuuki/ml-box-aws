import { formatBytes } from "./artifacts.ts";

const GIB = 1024 * 1024 * 1024;

/**
 * Formats a storage amount that the BFF sends in gigabytes.
 * Small amounts keep their byte unit: 32 bytes used to be shown as "0 GB" on the quota page
 * while the project page showed "32 B" for the same storage.
 */
export function formatStorage(gigabytes: number | null | undefined): string {
  if (gigabytes === null || gigabytes === undefined || !Number.isFinite(gigabytes)) return "—";
  if (gigabytes < 0) return "—";
  if (gigabytes >= 1) {
    return `${new Intl.NumberFormat(undefined, { maximumFractionDigits: 1 }).format(gigabytes)} GB`;
  }
  return formatBytes(gigabytes * GIB);
}

/** The share of the Space's storage that one Project holds, in percent. */
export function shareOfSpaceStorage(projectGb: number, spaceLimitGb: number): number {
  if (spaceLimitGb <= 0) return 0;
  return Math.min(100, (projectGb / spaceLimitGb) * 100);
}
