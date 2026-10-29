import assert from "node:assert/strict";
import test from "node:test";
import {
  ensureHubUser,
  hubActivationState,
  hubActivationUrl,
  hubFailure,
  mapHubServerState,
  mapHubStartResponse,
  resolveHubLifecycle,
  sandboxPath,
  sandboxUrl,
  startHubSandbox,
  type HubRequestResponse,
} from "./hub.js";

test("sandbox endpoints are scoped to the authenticated session username", () => {
  const username = "user-a@example.com";
  const path = sandboxPath(username, "sandbox-a");
  assert.equal(path, "/hub/api/users/user-a%40example.com/servers/sandbox-a");
  assert.equal(path.includes("user-b"), false);
  assert.throws(() => sandboxPath(username, "user-b/sandbox-b"), /Invalid sandbox name/);
  assert.throws(() => sandboxPath(username, "sandbox-b?user=user-b"), /Invalid sandbox name/);
});

test("lab URLs use the authenticated username and reject unsafe sandbox names", () => {
  assert.equal(sandboxUrl("https://notebook.example", "user-a@example.com", "sandbox-a"), "https://notebook.example/user/user-a%40example.com/sandbox-a/");
  assert.equal(sandboxUrl("https://notebook.example", "user-a@example.com", "default"), "https://notebook.example/user/user-a%40example.com/");
  assert.throws(() => sandboxUrl("https://notebook.example", "user-a@example.com", "user-b/server"), /Invalid sandbox name/);
  assert.throws(() => sandboxUrl("javascript:alert(1)", "user-a@example.com", "sandbox-a"), /Invalid Hub public URL/);
});

test("Hub activation state exposes a retryable trusted link", () => {
  assert.deepEqual(hubActivationState("https://notebook.example", false), {
    userExists: false,
    activationRequired: true,
    activationUrl: "https://notebook.example/hub/login",
  });
  assert.deepEqual(hubActivationState("https://notebook.example/", true), {
    userExists: true,
    activationRequired: false,
    activationUrl: "https://notebook.example/hub/login",
  });
  assert.throws(() => hubActivationUrl("javascript:alert(1)"), /Invalid Hub public URL/);
});

test("Hub user provisioning is idempotent for existing, new, and racing users", async () => {
  const calls: Array<{ method: string; path: string }> = [];
  let postBody: unknown = null;
  const existing = await ensureHubUser("user-a@example.com", async (method: string, path: string, _body: unknown) => {
    calls.push({ method, path });
    return { status: 200 };
  });
  assert.deepEqual(existing, { created: false });
  assert.deepEqual(calls, [{ method: "GET", path: "/hub/api/users/user-a%40example.com" }]);

  calls.length = 0;
  const created = await ensureHubUser("user-b@example.com", async (method: string, path: string, body: unknown) => {
    calls.push({ method, path });
    if (method === "GET") throw Object.assign(new Error("missing"), { status: 404 });
    postBody = body;
    return { status: 201 };
  });
  assert.deepEqual(created, { created: true });
  assert.deepEqual(calls, [
    { method: "GET", path: "/hub/api/users/user-b%40example.com" },
    { method: "POST", path: "/hub/api/users/user-b%40example.com" },
  ]);
  assert.deepEqual(postBody, {});

  const raced = await ensureHubUser("user-c@example.com", async (method: string, _path: string, _body: unknown) => {
    if (method === "GET") throw Object.assign(new Error("missing"), { status: 404 });
    throw Object.assign(new Error("already exists"), { status: 409 });
  });
  assert.deepEqual(raced, { created: false });
});

test("Hub sandbox start provisions a missing user and retries a 404 start once", async () => {
  const calls: string[] = [];
  let starts = 0;
  const result = await startHubSandbox({
    userExists: false,
    ensureUser: async () => {
      calls.push("ensure");
    },
    onRetry: async () => {
      calls.push("retry");
    },
    start: async () => {
      starts += 1;
      calls.push(`start-${starts}`);
      if (starts === 1) throw Object.assign(new Error("user propagation race"), { status: 404 });
      return { status: 202, body: null };
    },
  });
  assert.deepEqual(result, { status: 202, body: null });
  assert.deepEqual(calls, ["ensure", "start-1", "retry", "start-2"]);

  const existingUserCalls: string[] = [];
  await assert.rejects(() => startHubSandbox({
    userExists: true,
    ensureUser: async () => {
      existingUserCalls.push("unexpected-ensure");
    },
    start: async () => {
      existingUserCalls.push("start");
      throw Object.assign(new Error("server path missing"), { status: 404 });
    },
  }), /server path missing/);
  assert.deepEqual(existingUserCalls, ["start"]);
});

test("Hub lifecycle maps start response statuses and server states canonically", () => {
  const readyResponse: HubRequestResponse<{ state: string; ready: boolean; url: string }> = {
    status: 201,
    body: { state: "ready", ready: true, url: "/user/user-a/sandbox-a/" },
  };
  assert.equal(mapHubStartResponse(readyResponse), "ready");
  assert.equal(mapHubStartResponse({ status: 202, body: null }), "starting");
  assert.equal(mapHubServerState({ state: "pending", pending: true }), "starting");
  assert.equal(mapHubServerState({ state: "spawning" }), "starting");
  assert.equal(mapHubServerState({ state: "ready", ready: true, url: "/user/a/" }), "ready");
  assert.equal(mapHubServerState(null), "stopped");
  assert.equal(mapHubServerState({ state: "failed" }), "failed");
  assert.equal(mapHubServerState({ state: "error" }), "failed");
});

test("Hub lifecycle resolver polls with capped backoff until ready", async () => {
  const servers = [
    { state: "pending", pending: true },
    { state: "spawning", pending: true },
    { state: "ready", ready: true, url: "/user/a/sandbox/" },
  ];
  const delays: number[] = [];
  let now = 0;
  const result = await resolveHubLifecycle({
    read: async () => servers.shift() ?? null,
    maxAttempts: 5,
    timeoutMs: 1_000,
    backoffMs: 100,
    maxBackoffMs: 250,
    now: () => now,
    sleep: async (ms: number) => {
      delays.push(ms);
      now += ms;
    },
  });
  assert.equal(result, "ready");
  assert.deepEqual(delays, [100, 200]);
});

test("Hub lifecycle resolver bounds timeout and stops after failure", async () => {
  let reads = 0;
  let now = 0;
  const timeout = await resolveHubLifecycle({
    read: async () => {
      reads += 1;
      return { state: "pending", pending: true };
    },
    maxAttempts: 10,
    timeoutMs: 250,
    backoffMs: 100,
    maxBackoffMs: 200,
    now: () => now,
    sleep: async (ms: number) => {
      now += ms;
    },
  });
  assert.equal(timeout, "starting");
  assert.equal(reads, 3);

  let failureReads = 0;
  const failed = await resolveHubLifecycle({
    read: async () => {
      failureReads += 1;
      return failureReads === 1 ? { state: "failed" } : { state: "ready", ready: true, url: "/user/a/" };
    },
    maxAttempts: 3,
    timeoutMs: 1_000,
    backoffMs: 1,
    maxBackoffMs: 10,
    sleep: async () => undefined,
  });
  assert.equal(failed, "failed");
  assert.equal(failureReads, 1);
});

test("Hub failures distinguish client errors, Hub failures, and ambiguous transport failures", () => {
  assert.deepEqual(hubFailure(Object.assign(new Error("bad request"), { status: 400 })), {
    status: 400, code: "BAD_REQUEST", message: "JupyterHub không chấp nhận yêu cầu này.",
  });
  assert.equal(hubFailure(Object.assign(new Error("forbidden"), { status: 403 })).code, "FORBIDDEN");
  assert.equal(hubFailure(Object.assign(new Error("missing"), { status: 404 })).code, "SANDBOX_NOT_FOUND");
  assert.equal(hubFailure(Object.assign(new Error("overloaded"), { status: 503 })).status, 502);
  assert.equal(hubFailure(new TypeError("fetch failed")).code, "HUB_TIMEOUT");
});
