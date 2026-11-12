export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly data: Record<string, unknown>,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

let onUnauthorized: (() => void) | null = null;

/** The session provider registers itself here so any 401 sends the operator back to the login form. */
export function setUnauthorizedHandler(handler: (() => void) | null): void {
  onUnauthorized = handler;
}

export async function api<T>(path: string, options: { method?: "GET" | "POST"; body?: unknown } = {}): Promise<T> {
  const response = await fetch(path, {
    method: options.method ?? "GET",
    // The custom header is the CSRF check of the backend, next to the SameSite=Strict cookie.
    headers: { "content-type": "application/json", "x-requested-with": "mlbox-admin" },
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
    credentials: "same-origin",
  });
  const data = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  if (response.status === 401 && path !== "/api/login") onUnauthorized?.();
  if (!response.ok) throw new ApiError(typeof data.error === "string" ? data.error : `HTTP ${response.status}`, response.status, data);
  return data as T;
}
