"use client";

import { Toast } from "@heroui/react";

/** Mounts the toast region once for the whole app. Messages are raised with `toast.success` / `toast.danger`. */
export default function Toaster() {
  return <Toast.Provider placement="bottom end" />;
}
