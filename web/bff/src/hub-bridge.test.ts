import assert from "node:assert/strict";
import { test } from "node:test";
import { bearerMatches } from "./hub-bridge.js";

test("bearerMatches accepts only the exact bearer token", () => {
  assert.equal(bearerMatches("Bearer secret-1", "secret-1"), true);
  assert.equal(bearerMatches("Bearer secret-2", "secret-1"), false);
  assert.equal(bearerMatches("Bearer secret-1x", "secret-1"), false);
  assert.equal(bearerMatches("secret-1", "secret-1"), false);
  assert.equal(bearerMatches(undefined, "secret-1"), false);
});

test("bearerMatches fails closed when the expected token is not configured", () => {
  assert.equal(bearerMatches("Bearer ", undefined), false);
  assert.equal(bearerMatches("Bearer anything", ""), false);
});
