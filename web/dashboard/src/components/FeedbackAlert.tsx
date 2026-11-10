"use client";

import type { ReactNode } from "react";
import { Alert } from "@heroui/react";

/**
 * Outcome of a user action: a success confirmation or an error. Errors use role="alert" so assistive
 * technology announces them at once; successes use role="status".
 */
export default function FeedbackAlert({ status, children }: { status: "success" | "danger"; children: ReactNode }) {
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
