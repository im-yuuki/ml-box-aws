import { Chip } from "@heroui/react";
import type { ReactNode } from "react";
import { chipColor } from "@/lib/format";
import type { Status } from "@/lib/types";

/** A status word as a soft chip. The colour carries the state and the text repeats it, so it never relies on colour alone. */
export default function StatusChip({ status, children }: { status: Status; children: ReactNode }) {
  return (
    <Chip size="sm" variant="soft" color={chipColor(status)} className="w-fit">
      {children}
    </Chip>
  );
}
