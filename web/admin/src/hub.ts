import type { HubClient } from "./actions.js";

/** Stops a notebook server through the Hub REST API, with the same service token the BFF uses. Returns the HTTP status. */
export function createHubClient(hubUrl: string, token: string, fetchImpl: typeof fetch = fetch): HubClient {
  return {
    async stopServer(username, serverName) {
      const path = `/hub/api/users/${encodeURIComponent(username)}/servers/${encodeURIComponent(serverName)}`;
      const response = await fetchImpl(`${hubUrl}${path}`, {
        method: "DELETE",
        headers: { Authorization: `token ${token}`, Accept: "application/json" },
        signal: AbortSignal.timeout(15_000),
      });
      await response.body?.cancel();
      return response.status;
    },
  };
}
