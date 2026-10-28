import assert from "node:assert/strict";
import test from "node:test";
import { hubFailure, sandboxPath, sandboxUrl } from "./hub.js";

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

test("Hub failures distinguish client errors, Hub failures, and ambiguous transport failures", () => {
  assert.deepEqual(hubFailure(Object.assign(new Error("bad request"), { status: 400 })), {
    status: 400, code: "BAD_REQUEST", message: "JupyterHub không chấp nhận yêu cầu này.",
  });
  assert.equal(hubFailure(Object.assign(new Error("forbidden"), { status: 403 })).code, "FORBIDDEN");
  assert.equal(hubFailure(Object.assign(new Error("missing"), { status: 404 })).code, "SANDBOX_NOT_FOUND");
  assert.equal(hubFailure(Object.assign(new Error("overloaded"), { status: 503 })).status, 502);
  assert.equal(hubFailure(new TypeError("fetch failed")).code, "HUB_TIMEOUT");
});
