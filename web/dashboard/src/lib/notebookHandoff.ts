import { bffFetch } from "@/lib/bffFetch";

/**
 * Opens a sandbox notebook through the Hub handoff. The server URL alone is not enough: the Hub has no
 * session for this browser, so it would bounce to login. The BFF mints a one-time code for the signed-in
 * user and returns a Hub login URL that redeems it and lands on the notebook path.
 *
 * Must be called from a click handler. The tab is opened before the request so browsers do not block it
 * as a popup after the await; its URL is set once the handoff returns.
 */
export async function openNotebookViaHandoff(serverUrl: string): Promise<boolean> {
  const tab = window.open("about:blank", "_blank");
  if (tab) tab.opener = null;
  try {
    const path = new URL(serverUrl).pathname;
    const response = await bffFetch("/api/bff/hub/handoff", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ path }),
    });
    if (!response.ok) throw new Error("handoff failed");
    const body = (await response.json()) as { url?: unknown };
    if (typeof body.url !== "string") throw new Error("handoff failed");
    if (tab) {
      tab.location.href = body.url;
    } else {
      window.open(body.url, "_blank", "noopener");
    }
    return true;
  } catch {
    tab?.close();
    return false;
  }
}
