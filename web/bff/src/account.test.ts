import assert from "node:assert/strict";
import test from "node:test";
import { AVATAR_MAX_BYTES, describeUserAgent, parseBirthDate, parseProfileInput, validateAvatarDataUrl } from "./account.js";

test("profile input trims text, clears empty fields and rejects malformed values", () => {
  assert.deepEqual(parseProfileInput({ fullName: "  Nguyễn Văn A ", jobTitle: "", timezone: "Asia/Ho_Chi_Minh", birthDate: "1999-04-30", gender: "female" }), {
    fullName: "Nguyễn Văn A",
    jobTitle: null,
    timezone: "Asia/Ho_Chi_Minh",
    birthDate: "1999-04-30",
    gender: "female",
  });
  assert.equal(parseProfileInput({ fullName: "x".repeat(121) }), null);
  assert.equal(parseProfileInput({ fullName: 42 }), null);
  assert.equal(parseProfileInput({ timezone: "Mars/Olympus" }), null);
  assert.equal(parseProfileInput({ birthDate: "2100-01-01" }), null);
  assert.equal(parseProfileInput({ gender: "robot" }), null);
  assert.deepEqual(parseProfileInput(undefined), { fullName: null, jobTitle: null, timezone: null, birthDate: null, gender: null });
});

test("birth date must be a real calendar day between 1900 and today", () => {
  const today = new Date("2026-11-10T00:00:00Z");
  assert.equal(parseBirthDate("2000-02-29", today), "2000-02-29");
  assert.equal(parseBirthDate("2001-02-29", today), undefined);
  assert.equal(parseBirthDate("1899-12-31", today), undefined);
  assert.equal(parseBirthDate("2026-11-10", today), "2026-11-10");
  assert.equal(parseBirthDate("2026-11-11", today), undefined);
  assert.equal(parseBirthDate("", today), null);
  assert.equal(parseBirthDate("10/11/2000", today), undefined);
});

test("avatar accepts only small PNG, JPEG and WebP data URLs", () => {
  const small = "data:image/png;base64,iVBORw0KGgo=";
  assert.equal(validateAvatarDataUrl(small), small);
  assert.equal(validateAvatarDataUrl("data:image/svg+xml;base64,PHN2Zz4="), null);
  assert.equal(validateAvatarDataUrl("data:image/png;base64,"), null);
  assert.equal(validateAvatarDataUrl(null), null);
  const tooBig = `data:image/webp;base64,${"A".repeat(Math.ceil((AVATAR_MAX_BYTES * 4) / 3) + 8)}`;
  assert.equal(validateAvatarDataUrl(tooBig), null);
});

test("user agents become short device labels", () => {
  assert.equal(describeUserAgent("Mozilla/5.0 (Windows NT 10.0; Win64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36"), "Chrome · Windows");
  assert.equal(describeUserAgent("Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15"), "Safari · macOS");
  assert.equal(describeUserAgent("curl/8.0"), null);
});
