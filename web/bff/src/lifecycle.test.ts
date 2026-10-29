import assert from "node:assert/strict";
import test from "node:test";
import { AppStore } from "./app-store.js";
import { resolveStartLifecycle, requestHubResponse, shouldStartHubSandbox, shouldUseHubActivationFallback } from "./lifecycle.js";

test("Hub response helper preserves successful status and body without returning the token", async () => {
  const seen: { url?: string; authorization?: string } = {};
  const responses = [201, 202, 204].map((status) => ({
    status,
    ok: true,
    text: async () => status === 204 ? "" : JSON.stringify({ status }),
  }));
  for (const response of responses) {
    const result = await requestHubResponse<{ status: number }>({
      hubUrl: "https://hub.internal",
      hubApiToken: "secret-token",
      method: "POST",
      path: "/hub/api/users/user/servers/lab",
      body: {},
      fetchImpl: async (url, init) => {
        seen.url = url;
        seen.authorization = String(init.headers?.Authorization);
        return response;
      },
    });
    assert.equal(result.status, response.status);
    assert.deepEqual(result.body, response.status === 204 ? null : { status: response.status });
    assert.equal(JSON.stringify(result).includes("secret-token"), false);
  }
  assert.equal(seen.url, "https://hub.internal/hub/api/users/user/servers/lab");
  assert.equal(seen.authorization, "token secret-token");
});

test("Hub response helper retains typed status for non-success responses", async () => {
  await assert.rejects(
    requestHubResponse({
      hubUrl: "https://hub.internal",
      hubApiToken: "secret-token",
      method: "POST",
      path: "/hub/api/users/user/servers/lab",
      fetchImpl: async () => ({ status: 404, ok: false, text: async () => "missing" }),
    }),
    (error: unknown) => error instanceof Error && (error as Error & { status?: number }).status === 404,
  );
});

test("Hub activation fallback is only used for a missing Hub user", () => {
  assert.equal(shouldUseHubActivationFallback(false, Object.assign(new Error("missing user"), { status: 404 })), true);
  assert.equal(shouldUseHubActivationFallback(true, Object.assign(new Error("server path missing"), { status: 404 })), false);
  assert.equal(shouldUseHubActivationFallback(false, Object.assign(new Error("forbidden"), { status: 403 })), false);
});

test("start lifecycle preserves 201 and 202 response status while resolving canonical state", async () => {
  const ready = await resolveStartLifecycle({
    start: async () => ({ status: 201, body: { state: "ready", ready: true, url: "/user/demo/lab/" } }),
  });
  assert.deepEqual(ready, { state: "ready", status: 201, body: { state: "ready", ready: true, url: "/user/demo/lab/" } });

  let reads = 0;
  const pending = await resolveStartLifecycle({
    start: async () => ({ status: 202, body: null }),
    read: async () => {
      reads += 1;
      return reads === 1 ? { state: "pending", pending: true } : { state: "ready", ready: true, url: "/user/demo/lab/" };
    },
    maxAttempts: 2,
    timeoutMs: 1_000,
    backoffMs: 0,
    maxBackoffMs: 0,
    sleep: async () => undefined,
  });
  assert.equal(pending.state, "ready");
  assert.equal(pending.status, 202);
  assert.equal(reads, 2);
});

test("start lifecycle skips a duplicate Hub start for an already active server", () => {
  assert.equal(shouldStartHubSandbox({ state: "pending", pending: true }), false);
  assert.equal(shouldStartHubSandbox({ state: "starting", pending: true }), false);
  assert.equal(shouldStartHubSandbox({ state: "ready", ready: true, url: "/user/demo/lab/" }), false);
  assert.equal(shouldStartHubSandbox({ state: "stopped" }), true);
  assert.equal(shouldStartHubSandbox({ state: "failed" }), true);
  assert.equal(shouldStartHubSandbox(null), true);
});

test("start lifecycle audits requested then starting and resolves ready", async () => {
  const actions: string[] = [];
  let reads = 0;
  const result = await resolveStartLifecycle({
    start: async () => ({ status: 202, body: null }),
    read: async () => {
      reads += 1;
      return reads === 1 ? { state: "pending", pending: true } : { state: "ready", ready: true, url: "/user/demo/lab/" };
    },
    audit: async (action) => actions.push(action),
    maxAttempts: 3,
    timeoutMs: 1_000,
    backoffMs: 0,
    maxBackoffMs: 0,
    sleep: async () => undefined,
  });
  assert.equal(result.state, "ready");
  assert.deepEqual(actions, ["sandbox.start_requested", "sandbox.starting", "sandbox.ready"]);
});

test("start lifecycle audits failure and does not retry a failed start", async () => {
  const actions: string[] = [];
  const result = await resolveStartLifecycle({
    start: async () => ({ status: 201, body: { state: "failed" } }),
    audit: async (action) => actions.push(action),
    maxAttempts: 2,
    timeoutMs: 100,
    backoffMs: 0,
    maxBackoffMs: 0,
    sleep: async () => undefined,
  });
  assert.equal(result.state, "failed");
  assert.deepEqual(actions, ["sandbox.start_requested", "sandbox.failed"]);
});

test("recordAuditEvent writes safe lifecycle metadata and surfaces database failure for best-effort callers", async () => {
  const queries: Array<{ sql: string; values?: unknown[] }> = [];
  const store = new AppStore({
    query: async (sql: string, values?: unknown[]) => {
      queries.push({ sql, values });
      return { rows: [] };
    },
    connect: async () => { throw new Error("connect is not expected"); },
    end: async () => undefined,
  });
  await store.recordAuditEvent("cognito-sub", "personal:cognito-sub", "sandbox.ready", "sandbox-a", { state: "ready", status: 201 });
  assert.match(queries[0].sql, /mlbox_audit_events/);
  assert.deepEqual(queries[0].values?.slice(1, 5), ["personal:cognito-sub", "cognito-sub", "sandbox.ready", "sandbox-a"]);
  assert.deepEqual(JSON.parse(String(queries[0].values?.[5])), { state: "ready", status: 201 });

  const failing = new AppStore({
    query: async () => { throw new Error("database unavailable"); },
    connect: async () => { throw new Error("connect is not expected"); },
    end: async () => undefined,
  });
  await assert.rejects(failing.recordAuditEvent("user", "space", "sandbox.failed", "sandbox-a"), /database unavailable/);
});
