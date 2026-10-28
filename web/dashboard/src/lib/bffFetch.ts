/** Fetch through the dashboard BFF proxy, attaching its double-submit CSRF token to writes. */
export async function bffFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const method = (init.method ?? "GET").toUpperCase();
  if (["GET", "HEAD", "OPTIONS"].includes(method)) {
    const response = await fetch(path, { ...init, cache: "no-store" });
    return response.status === 401 && !isAuthEndpoint(path) ? refreshAndRetry(path, init) : response;
  }

  const csrfResponse = await fetch("/api/bff/auth/csrf", { cache: "no-store" });
  if (!csrfResponse.ok) throw new Error("Could not initialize request security.");
  const { csrfToken } = (await csrfResponse.json()) as { csrfToken?: string };
  if (!csrfToken) throw new Error("Could not initialize request security.");

  const headers = new Headers(init.headers);
  headers.set("x-csrf-token", csrfToken);
  const response = await fetch(path, { ...init, headers, cache: "no-store" });
  return response.status === 401 && !isAuthEndpoint(path) ? refreshAndRetry(path, init) : response;
}

function isAuthEndpoint(path: string): boolean {
  return /\/auth\/(?:csrf|login|register|confirm|resend-confirmation|forgot-password|reset-password|logout|refresh)(?:\?|$)/.test(path);
}

async function refreshAndRetry(path: string, init: RequestInit): Promise<Response> {
  try {
    const csrfResponse = await fetch("/api/bff/auth/csrf", { cache: "no-store" });
    if (!csrfResponse.ok) return new Response(null, { status: 401 });
    const { csrfToken } = (await csrfResponse.json()) as { csrfToken?: string };
    if (!csrfToken) return new Response(null, { status: 401 });
    const refresh = await fetch("/api/bff/auth/refresh", {
      method: "POST",
      headers: { "x-csrf-token": csrfToken },
      cache: "no-store",
    });
    if (!refresh.ok) return new Response(null, { status: 401 });
    const headers = new Headers(init.headers);
    if (!(["GET", "HEAD", "OPTIONS"].includes((init.method ?? "GET").toUpperCase()))) {
      headers.set("x-csrf-token", csrfToken);
    }
    return fetch(path, { ...init, headers, cache: "no-store" });
  } catch {
    return new Response(null, { status: 401 });
  }
}
