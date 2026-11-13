import assert from "node:assert/strict";
import test from "node:test";

import { createHubClient } from "./hub.js";

test("the Hub client sends a DELETE with the service token and escapes the names", async () => {
  const seen: { url: string; init: RequestInit }[] = [];
  const fake = (async (url: string, init: RequestInit) => {
    seen.push({ url, init });
    return new Response(null, { status: 202 });
  }) as unknown as typeof fetch;
  const status = await createHubClient("http://hub.local", "s3cret", fake).stopServer("a b", "proj-1");
  assert.equal(status, 202);
  assert.equal(seen[0].url, "http://hub.local/hub/api/users/a%20b/servers/proj-1");
  assert.equal(seen[0].init.method, "DELETE");
  assert.equal((seen[0].init.headers as Record<string, string>).Authorization, "token s3cret");
});

test("a Hub error status is returned, not thrown, so the action decides what it means", async () => {
  const fake = (async () => new Response(null, { status: 403 })) as unknown as typeof fetch;
  assert.equal(await createHubClient("http://hub.local", "t", fake).stopServer("u", "s"), 403);
});
