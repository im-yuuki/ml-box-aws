import assert from "node:assert/strict";
import test from "node:test";
import { verifyTurnstile, type TurnstileFetch } from "./turnstile.js";

const okFetch: TurnstileFetch = async () => new Response(JSON.stringify({ success: true }), { status: 200 });

function okResponse(): Response {
  return new Response(JSON.stringify({ success: true }), { status: 200 });
}

test("disabled Turnstile accepts a missing token without contacting Siteverify", async () => {
  let calls = 0;
  const fetcher: TurnstileFetch = async () => {
    calls += 1;
    return okResponse();
  };

  const result = await verifyTurnstile({ enabled: false, token: undefined, secret: undefined, fetcher });

  assert.deepEqual(result, { ok: true, reason: "disabled" });
  assert.equal(calls, 0);
});

test("enabled Turnstile rejects a missing token", async () => {
  const result = await verifyTurnstile({ enabled: true, token: undefined, secret: "secret", fetcher: okFetch });

  assert.deepEqual(result, { ok: false, reason: "missing-token" });
});

test("enabled Turnstile accepts only a successful Siteverify response", async () => {
  let requestBody = "";
  const fetcher: TurnstileFetch = async (_url, init) => {
    requestBody = String(init?.body ?? "");
    return okResponse();
  };

  const result = await verifyTurnstile({ enabled: true, token: "token", secret: "secret", remoteIp: "198.51.100.5", fetcher });

  assert.deepEqual(result, { ok: true, reason: "verified" });
  assert.match(requestBody, /secret=secret/);
  assert.match(requestBody, /response=token/);
  assert.match(requestBody, /remoteip=198.51.100.5/);
});

test("enabled Turnstile fails closed for invalid, expired, and unavailable verification", async () => {
  const invalid = await verifyTurnstile({
    enabled: true,
    token: "token",
    secret: "secret",
    fetcher: async () => new Response(JSON.stringify({ success: false, "error-codes": ["timeout-or-duplicate"] }), { status: 200 }),
  });
  const unavailable = await verifyTurnstile({
    enabled: true,
    token: "token",
    secret: "secret",
    fetcher: async () => { throw new Error("provider unavailable"); },
  });

  assert.deepEqual(invalid, { ok: false, reason: "rejected" });
  assert.deepEqual(unavailable, { ok: false, reason: "unavailable" });
});
