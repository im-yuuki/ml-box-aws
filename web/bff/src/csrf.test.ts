import assert from "node:assert/strict";
import test from "node:test";
import { validCsrfPair } from "./csrf.js";

test("CSRF validation requires matching cookie and header values", () => {
  assert.equal(validCsrfPair("token", "token"), true);
  assert.equal(validCsrfPair("token", "other"), false);
  assert.equal(validCsrfPair("token", "tokens"), false);
  assert.equal(validCsrfPair(undefined, "token"), false);
  assert.equal(validCsrfPair("token", undefined), false);
});
