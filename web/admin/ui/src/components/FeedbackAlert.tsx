"use client";

import { useEffect, type ReactNode } from "react";
import { Alert, toast } from "@heroui/react";

// React runs effects twice in development (StrictMode). Identical messages raised within this window are shown once.
const DEDUPE_WINDOW_MS = 1000;
const recent = new Map<string, number>();

type Status = "success" | "danger" | "warning";

function raise(status: Status, message: ReactNode) {
  const key = `${status}:${typeof message === "string" ? message : ""}`;
  if (typeof message === "string") {
    const now = Date.now();
    const last = recent.get(key);
    if (last !== undefined && now - last < DEDUPE_WINDOW_MS) return;
    recent.set(key, now);
  }
  if (status === "danger") toast.danger(message);
  else if (status === "warning") toast.warning(message);
  else toast.success(message);
}

/**
 * Outcome of a user action. Errors and warnings stay inline, where the user is looking: a form error
 * that only lives in a corner toast for four seconds is easy to miss and cannot be read again. Success
 * confirmations are toasts, so a successful action does not move the layout under the cursor. Pass
 * `toast` to show an error as a toast as well.
 */
export default function FeedbackAlert({
  status,
  children,
  toast: asToast = false,
}: {
  status: Status;
  children: ReactNode;
  toast?: boolean;
}) {
  const inline = !asToast && status !== "success";
  useEffect(() => {
    if (!inline) raise(status, children);
  }, [inline, status, children]);
  if (!inline) {
    // A success is shown as a toast, so it does not move the layout. The message is repeated in a
    // hidden live region, so a screen reader announces it too.
    return (
      <span className="sr-only" role="status">
        {status === "success" ? children : null}
      </span>
    );
  }
  return (
    <div role={status === "danger" ? "alert" : "status"}>
      <Alert status={status}>
        <Alert.Indicator />
        <Alert.Content>
          <Alert.Description>{children}</Alert.Description>
        </Alert.Content>
      </Alert>
    </div>
  );
}
