import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { contentSecurityPolicy, inlineScriptHashes, loadStaticFiles, routesFor } from "./static-files.js";

test("inline scripts are hashed and external scripts are not", () => {
  const html = `<script src="/a.js"></script><script>var x=1</script><script id="d">self.__next_f.push([1])</script><script></script>`;
  const expected = (text: string) => `'sha256-${createHash("sha256").update(text).digest("base64")}'`;
  assert.deepEqual(inlineScriptHashes(html), [expected("var x=1"), expected("self.__next_f.push([1])")]);
});

test("the policy forbids unhashed inline scripts, plugins and framing", () => {
  const policy = contentSecurityPolicy(["'sha256-abc'"]);
  assert.match(policy, /script-src 'self' 'sha256-abc'/);
  assert.doesNotMatch(policy, /script-src[^;]*unsafe-inline/);
  assert.match(policy, /object-src 'none'/);
  assert.match(policy, /frame-ancestors 'none'/);
});

test("a directory index answers with and without the trailing slash", () => {
  assert.deepEqual(routesFor("index.html"), ["/"]);
  assert.deepEqual(routesFor("sandboxes/index.html"), ["/sandboxes/", "/sandboxes"]);
  assert.deepEqual(routesFor("_next/static/app.js"), ["/_next/static/app.js"]);
});

test("only exported files can be served, and hashed assets are cached for good", () => {
  const root = mkdtempSync(join(tmpdir(), "admin-ui-"));
  mkdirSync(join(root, "_next", "static"), { recursive: true });
  mkdirSync(join(root, "audit"));
  writeFileSync(join(root, "index.html"), "<html><script>boot()</script></html>");
  writeFileSync(join(root, "audit", "index.html"), "<html></html>");
  writeFileSync(join(root, "_next", "static", "app.js"), "1");
  writeFileSync(join(root, "secret.env"), "TOKEN=1");

  const files = loadStaticFiles(root);
  assert.ok(files.has("/"));
  assert.ok(files.has("/audit/"));
  assert.ok(files.has("/_next/static/app.js"));
  assert.equal(files.get("/_next/static/app.js")?.cache, "public, max-age=31536000, immutable");
  assert.equal(files.get("/")?.cache, "no-store");
  assert.match(files.get("/")?.csp ?? "", /sha256-/);
  assert.equal(files.has("/secret.env"), false);
  assert.equal(files.has("/../package.json"), false);
});
