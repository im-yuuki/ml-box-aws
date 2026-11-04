import assert from "node:assert/strict";
import test from "node:test";

import {
  classifyTeamResponse,
  memberLabel,
  parseTeamRole,
  validateMemberId,
  validateTeamName,
} from "./teams.ts";

test("team responses map to explicit load states", () => {
  assert.equal(classifyTeamResponse(200), "ready");
  assert.equal(classifyTeamResponse(401), "unauthenticated");
  assert.equal(classifyTeamResponse(403), "unauthorized");
  assert.equal(classifyTeamResponse(503), "unavailable");
});

test("team names are trimmed, required and bounded", () => {
  assert.deepEqual(validateTeamName("  Data  "), { ok: true, value: "Data" });
  assert.equal(validateTeamName("   ").ok, false);
  assert.equal(validateTeamName("x".repeat(61)).ok, false);
});

test("member identifiers reject blanks and embedded whitespace", () => {
  assert.deepEqual(validateMemberId(" abc-123 "), { ok: true, value: "abc-123" });
  assert.equal(validateMemberId("").ok, false);
  assert.equal(validateMemberId("two words").ok, false);
});

test("team role parsing accepts only lead or member", () => {
  assert.equal(parseTeamRole("lead"), "lead");
  assert.equal(parseTeamRole("owner"), null);
});

test("member label prefers email and falls back to the subject", () => {
  assert.equal(memberLabel({ userId: "u1", role: "member", email: "a@example.com" }), "a@example.com");
  assert.equal(memberLabel({ userId: "u1", role: "member", email: null }), "u1");
});
