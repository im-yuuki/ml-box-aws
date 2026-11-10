"use client";

import { useEffect, type ReactNode } from "react";
import { toast } from "@heroui/react";

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
 * Outcome of a user action, shown as a toast. Mount it when there is something to report; it raises the
 * toast once and renders nothing. Errors are announced by the toast region itself.
 */
export default function FeedbackAlert({ status, children }: { status: Status; children: ReactNode }) {
  useEffect(() => {
    raise(status, children);
  }, [status, children]);
  return null;
}
