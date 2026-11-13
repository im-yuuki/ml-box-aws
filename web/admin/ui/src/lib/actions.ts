import { api, ApiError } from "@/lib/api";

export const REASON_MIN = 5;
export const REASON_MAX = 300;

export function reasonIsValid(reason: string): boolean {
  const length = reason.trim().length;
  return length >= REASON_MIN && length <= REASON_MAX;
}

/** Sends a change to the console. The backend refuses it without a reason and records it before it runs. */
export function sendAction(path: string, body: Record<string, unknown>, reason: string): Promise<{ ok: true; auditId: string; detail: Record<string, unknown> }> {
  return api(path, { method: "POST", body: { ...body, reason: reason.trim() } });
}

export type ActionErrorKey = "invalidReason" | "disabled" | "notFound" | "invalid" | "unavailable" | "upstream" | "failed";

/** Maps the error codes of the backend to a message key; the text of the message is the console's, in the language of the operator. */
export function actionErrorKey(error: unknown): ActionErrorKey {
  if (!(error instanceof ApiError)) return "failed";
  switch (error.message) {
    case "INVALID_REASON":
      return "invalidReason";
    case "ACTIONS_DISABLED":
      return "disabled";
    case "NOT_FOUND":
      return "notFound";
    case "INVALID":
    case "BAD_REQUEST":
      return "invalid";
    case "UNAVAILABLE":
      return "unavailable";
    case "UPSTREAM":
      return "upstream";
    default:
      return "failed";
  }
}
