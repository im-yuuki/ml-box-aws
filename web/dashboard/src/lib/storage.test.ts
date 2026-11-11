import assert from "node:assert/strict";
import test from "node:test";

import { formatStorage, shareOfSpaceStorage } from "./storage.ts";

test("storage keeps its byte unit below one gigabyte", () => {
  // 32 bytes is the case that used to be printed as "0 GB".
  assert.equal(formatStorage(32 / (1024 * 1024 * 1024)), "32 B");
  assert.equal(formatStorage(0.5), "512 MB");
});

test("storage from one gigabyte up is shown in gigabytes", () => {
  assert.equal(formatStorage(5), "5 GB");
  assert.equal(formatStorage(100), "100 GB");
  assert.equal(formatStorage(2.25), "2.3 GB");
});

test("storage without a measurement is not a number", () => {
  assert.equal(formatStorage(null), "—");
  assert.equal(formatStorage(undefined), "—");
  assert.equal(formatStorage(Number.NaN), "—");
  assert.equal(formatStorage(-1), "—");
});

test("the share of the Space storage is capped at the limit", () => {
  assert.equal(shareOfSpaceStorage(1, 100), 1);
  assert.equal(shareOfSpaceStorage(50, 100), 50);
  assert.equal(shareOfSpaceStorage(120, 100), 100);
  assert.equal(shareOfSpaceStorage(1, 0), 0);
});
