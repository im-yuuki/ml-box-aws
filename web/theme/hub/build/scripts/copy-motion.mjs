/**
 * Vendor the browser-ready Motion IIFE build into ../static/motion.js.
 *
 * The `motion` package (framer-motion vanilla) ships dist/motion.js, a
 * self-executing IIFE that exposes the API on `window.Motion`. We copy it
 * verbatim so hub pages can load it with a plain <script> tag — no bundler.
 */
import { copyFile, readFile, readdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const here = path.dirname(fileURLToPath(import.meta.url));
const buildDir = path.resolve(here, "..");
const distCandidates = [
  path.join(buildDir, "node_modules", "motion", "dist", "motion.js"),
];
const outPath = path.resolve(buildDir, "..", "static", "motion.js");

let src = null;
for (const candidate of distCandidates) {
  try {
    await readFile(candidate, "utf8");
    src = candidate;
    break;
  } catch {
    // try next candidate
  }
}

if (!src) {
  let dist = "(-)";
  try {
    dist = await readdir(path.join(buildDir, "node_modules", "motion", "dist"));
  } catch {
    // node_modules/motion not installed
  }
  console.error(
    `[copy-motion] Could not find motion/dist/motion.js.\n` +
      `[copy-motion] Run "npm install" in web/theme/hub/build first.\n` +
      `[copy-motion] dist contents: ${dist}`,
  );
  process.exit(1);
}

await copyFile(src, outPath);
console.log(`[copy-motion] vendored ${path.relative(buildDir, src)} -> ${path.relative(buildDir, outPath)}`);
