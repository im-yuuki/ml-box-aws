import { createHash } from "node:crypto";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { extname, join, relative, sep } from "node:path";

export type StaticFile = { body: Buffer; type: string; csp: string; cache: string };

const TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".png": "image/png",
  ".woff2": "font/woff2",
  ".woff": "font/woff",
  ".txt": "text/plain; charset=utf-8",
};

/** The inline scripts of an exported page (Next.js hydration data, the theme bootstrap), as CSP hashes. */
export function inlineScriptHashes(html: string): string[] {
  const hashes = new Set<string>();
  for (const match of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)) {
    if (/\bsrc\s*=/.test(match[1]) || match[2].length === 0) continue;
    hashes.add(`'sha256-${createHash("sha256").update(match[2], "utf8").digest("base64")}'`);
  }
  return [...hashes];
}

/**
 * Scripts must come from this origin or match a hash computed from the exported page itself, so an injected
 * script cannot run. Styles allow inline attributes because HeroUI and React Aria write style attributes.
 */
export function contentSecurityPolicy(scriptHashes: string[] = []): string {
  return [
    "default-src 'self'",
    `script-src 'self' ${scriptHashes.join(" ")}`.trim(),
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data:",
    "font-src 'self'",
    "connect-src 'self'",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join("; ");
}

function* walk(directory: string): Generator<string> {
  for (const entry of readdirSync(directory)) {
    const path = join(directory, entry);
    if (statSync(path).isDirectory()) yield* walk(path);
    else yield path;
  }
}

/** URL paths that serve a file: `a/index.html` answers `/a/` and `/a`, `index.html` answers `/`. */
export function routesFor(relativePosixPath: string): string[] {
  if (relativePosixPath === "index.html") return ["/"];
  if (relativePosixPath.endsWith("/index.html")) {
    const directory = relativePosixPath.slice(0, -"/index.html".length);
    return [`/${directory}/`, `/${directory}`];
  }
  return [`/${relativePosixPath}`];
}

/**
 * Reads the exported console once, at start. Only files that existed then can be served, from a table keyed by the
 * exact URL path, so a request can never name a file on disk.
 */
export function loadStaticFiles(root: string): Map<string, StaticFile> {
  const files = new Map<string, StaticFile>();
  for (const path of walk(root)) {
    const posix = relative(root, path).split(sep).join("/");
    const extension = extname(path).toLowerCase();
    const type = TYPES[extension];
    if (!type) continue;
    const body = readFileSync(path);
    const isHtml = extension === ".html";
    const file: StaticFile = {
      body,
      type,
      csp: contentSecurityPolicy(isHtml ? inlineScriptHashes(body.toString("utf8")) : []),
      cache: posix.startsWith("_next/static/") ? "public, max-age=31536000, immutable" : "no-store",
    };
    for (const route of routesFor(posix)) files.set(route, file);
  }
  return files;
}
