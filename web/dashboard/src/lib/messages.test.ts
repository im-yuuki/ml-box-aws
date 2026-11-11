import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { findDuplicateKeys } from "./jsonKeys.ts";

// The message files are the one place where a duplicated key silently kills a translation:
// JSON.parse keeps the last value, so the app shows an older wording without any error.
for (const file of ["en.json", "vi.json"]) {
  test(`the message file ${file} has no duplicated key`, () => {
    const text = readFileSync(new URL(`../messages/${file}`, import.meta.url), "utf8");
    assert.deepEqual(findDuplicateKeys(text), []);
  });
}

test("a duplicated key is found with its path", () => {
  assert.deepEqual(findDuplicateKeys('{"a": {"b": 1, "b": 2}}'), [{ path: "a.b", key: "b" }]);
  assert.deepEqual(findDuplicateKeys('{"a": 1, "a": 2}'), [{ path: "a", key: "a" }]);
  assert.deepEqual(findDuplicateKeys('{"a": [{"b": 1}, {"b": 2}]}'), []);
});
