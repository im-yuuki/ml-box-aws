"use client";

import { useId, useState } from "react";
import { Button } from "@heroui/react";
import ActionDialog, { type ActionRequest } from "@/components/ActionDialog";
import { useSession } from "@/components/SessionProvider";

/** True when the backend has switched changes on. Buttons that change something are not drawn otherwise. */
export function useActionsEnabled(): boolean {
  const { session } = useSession();
  return session.status === "authenticated" && session.features.actions;
}

/**
 * A button that opens the confirmation dialog of a change. `build` is called on every render while the dialog is open,
 * so the dialog always sees the current state of the component that owns the button (a chosen plan, for example).
 */
export default function ActionButton({
  trigger,
  danger = false,
  build,
}: {
  trigger: string;
  danger?: boolean;
  build: () => Omit<ActionRequest, "id" | "danger">;
}) {
  const enabled = useActionsEnabled();
  const id = useId();
  const [open, setOpen] = useState(false);
  if (!enabled) return null;
  return (
    <>
      <Button size="sm" variant={danger ? "danger-soft" : "secondary"} onPress={() => setOpen(true)}>
        {trigger}
      </Button>
      <ActionDialog request={open ? { id, danger, ...build() } : null} onClose={() => setOpen(false)} />
    </>
  );
}
