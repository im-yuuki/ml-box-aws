import { cookies } from "next/headers";

const SESSION_COOKIE = "mlbox_session";

/**
 * Whether the visitor already has a session. The BFF answers the Space list only for a valid
 * session, so the landing page can offer "Open workspace" instead of "Sign in" to a signed in
 * user. A BFF that cannot be reached means "signed out": the page stays readable.
 */
export async function hasSession(): Promise<boolean> {
  const baseUrl = process.env.BFF_INTERNAL_URL?.replace(/\/$/, "");
  if (!baseUrl) return false;
  const cookie = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!cookie) return false;
  try {
    const response = await fetch(`${baseUrl}/v1/spaces`, {
      headers: { cookie: `${SESSION_COOKIE}=${cookie}`, accept: "application/json" },
      cache: "no-store",
    });
    return response.ok;
  } catch {
    return false;
  }
}
