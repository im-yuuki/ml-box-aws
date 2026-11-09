import assert from "node:assert/strict";
import test from "node:test";
import { AVATAR_MAX_BYTES, describeUserAgent, parseProfileInput, validateAvatarDataUrl } from "./account.js";

test("profile input trims text, clears empty fields and rejects malformed values", () => {
  assert.deepEqual(parseProfileInput({ fullName: "  Nguyễn Văn A ", jobTitle: "", timezone: "Asia/Ho_Chi_Minh" }), {
    fullName: "Nguyễn Văn A",
    jobTitle: null,
    timezone: "Asia/Ho_Chi_Minh",
  });
  assert.equal(parseProfileInput({ fullName: "x".repeat(121) }), null);
  assert.equal(parseProfileInput({ fullName: 42 }), null);
  assert.equal(parseProfileInput({ timezone: "Mars/Olympus" }), null);
  assert.deepEqual(parseProfileInput(undefined), { fullName: null, jobTitle: null, timezone: null });
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
  assert.equal(describeUserAgent("curl/8.0"), "Trình duyệt không xác định");
});
