export type TurnstileFetch = (input: string | URL, init?: RequestInit) => Promise<Response>;

export type TurnstileResult =
  | { ok: true; reason: "disabled" | "verified" }
  | { ok: false; reason: "missing-token" | "rejected" | "unavailable" };

export type TurnstileOptions = {
  enabled: boolean;
  token?: string;
  secret?: string;
  remoteIp?: string;
  fetcher?: TurnstileFetch;
};

const SITEVERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";

export async function verifyTurnstile(options: TurnstileOptions): Promise<TurnstileResult> {
  if (!options.enabled) return { ok: true, reason: "disabled" };
  if (!options.token || !options.secret) return { ok: false, reason: "missing-token" };

  const body = new URLSearchParams({ secret: options.secret, response: options.token });
  if (options.remoteIp) body.set("remoteip", options.remoteIp);
  try {
    const response = await (options.fetcher ?? fetch)(SITEVERIFY_URL, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body,
      signal: AbortSignal.timeout(5000),
    });
    if (!response.ok) return { ok: false, reason: "unavailable" };
    const result = await response.json() as { success?: unknown };
    return result.success === true ? { ok: true, reason: "verified" } : { ok: false, reason: "rejected" };
  } catch {
    return { ok: false, reason: "unavailable" };
  }
}
